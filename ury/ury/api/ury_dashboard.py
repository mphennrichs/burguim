import frappe

from frappe.utils import get_datetime, datetime, add_to_date, today
from ury.ury_pos.api import getBranch


def _resolve_scoped_branch(branch):
	"""Administrator/System Manager may request any branch or the global
	aggregate (branch=None); everyone else is confined to their own branch
	(getBranch()), regardless of what they pass — these endpoints had no
	authorization check at all before, so any authenticated user could read
	another branch's sales/ops data via ?branch=X (or every branch's via
	omitting it)."""
	if frappe.session.user == "Administrator" or "System Manager" in frappe.get_roles():
		return branch
	return getBranch()


@frappe.whitelist(methods=["GET"])
def get_dashboard_stats(branch=None):
	branch = _resolve_scoped_branch(branch)
	cache_key = f"ury_dashboard_stats:{branch}"
	cached = frappe.cache().get_value(cache_key)
	if cached:
		return cached

	if branch:
		result = frappe.db.sql(
			"""
			SELECT
				COUNT(b.`name`) AS total_invoices,
				ROUND(SUM(b.`grand_total`), 2) AS grand_total
			FROM `tabPOS Invoice` b
			LEFT JOIN `tabURY Report Settings` rs ON (rs.`branch` = %(branch)s)
			WHERE
				b.`branch` = %(branch)s
				AND b.`docstatus` = 1
				AND b.`status` IN ("Consolidated", "Paid")
				AND (
					((rs.`hours` IS NULL OR rs.`hours` = 0) AND b.`posting_date` = curdate())
					OR (rs.`hours` > 0 AND TIMESTAMP(b.`posting_date`, b.`posting_time`) <= TIMESTAMP(DATE_ADD(curdate(), INTERVAL 1 DAY), CONCAT(LPAD(rs.`hours`, 2, '0'), ':00:00')) AND TIMESTAMP(b.`posting_date`, b.`posting_time`) >= TIMESTAMP(curdate(), CONCAT(LPAD(rs.`hours`, 2, '0'), ':00:00')))
					OR (rs.`branch` IS NULL AND b.`posting_date` = curdate())
				)
			""",
			{"branch": branch},
			as_dict=True,
		)[0]
	else:
		result = frappe.db.sql(
			"""
			SELECT
				COUNT(b.`name`) AS total_invoices,
				ROUND(SUM(b.`grand_total`), 2) AS grand_total
			FROM `tabPOS Invoice` b
			LEFT JOIN `tabURY Report Settings` rs ON (rs.`branch` IS NULL)
			WHERE
				b.`docstatus` = 1
				AND b.`status` IN ("Consolidated", "Paid")
				AND (
					((rs.`hours` IS NULL OR rs.`hours` = 0) AND b.`posting_date` = curdate())
					OR (rs.`hours` > 0 AND TIMESTAMP(b.`posting_date`, b.`posting_time`) <= TIMESTAMP(DATE_ADD(curdate(), INTERVAL 1 DAY), CONCAT(LPAD(rs.`hours`, 2, '0'), ':00:00')) AND TIMESTAMP(b.`posting_date`, b.`posting_time`) >= TIMESTAMP(curdate(), CONCAT(LPAD(rs.`hours`, 2, '0'), ':00:00')))
					OR (rs.`branch` IS NULL AND b.`posting_date` = curdate())
				)
			""",
			{},
			as_dict=True,
		)[0]

	grand_total = result.grand_total or 0
	total_invoices = result.total_invoices or 0
	avg_order_value = round(grand_total / total_invoices, 2) if total_invoices else 0

	result_dict = {
		"todays_sales": grand_total,
		"orders_today": total_invoices,
		"avg_order_value": avg_order_value,
	}

	frappe.cache().set_value(cache_key, result_dict, expires_in_sec=30)
	return result_dict


@frappe.whitelist(methods=["GET"])
def get_needs_attention(branch=None):
	branch = _resolve_scoped_branch(branch)
	cache_key = f"ury_dashboard_needs_attention:{branch}"
	cached = frappe.cache().get_value(cache_key)
	if cached:
		return cached

	items = []

	threshold = add_to_date(get_datetime(), minutes=-15)
	shift_start = today()
	pending = frappe.db.sql(
		"""SELECT name, creation FROM `tabPOS Invoice`
		   WHERE docstatus = 0 AND creation < %(threshold)s AND creation >= %(shift_start)s""" +
		(" AND branch = %(branch)s" if branch else ""),
		{"threshold": threshold, "shift_start": shift_start, "branch": branch},
		as_dict=True,
	)
	if pending:
		items.append({
			"type": "pending_payment",
			"message": f"{len(pending)} order(s) pending payment for over 15 minutes",
			"severity": "high",
			"reference": None,
		})

	stale_sessions = frappe.get_all(
		"POS Opening Entry",
		filters={"status": "Open", "docstatus": 1, "posting_date": ["<", today()]},
		fields=["name"],
	)
	if stale_sessions:
		items.append({
			"type": "unclosed_pos_session",
			"message": f"{len(stale_sessions)} POS session(s) left open from a previous day",
			"severity": "high",
			"reference": None,
		})

	frappe.cache().set_value(cache_key, items, expires_in_sec=30)
	return items


def _business_day_bounds(branch):
	rs_hours = frappe.db.get_value("URY Report Settings", {"branch": branch}, "hours") if branch else None
	now = get_datetime()
	if rs_hours:
		cutoff_today = get_datetime(f"{today()} {str(rs_hours).zfill(2)}:00:00")
		if now < cutoff_today:
			start = add_to_date(cutoff_today, days=-1)
			end = cutoff_today
		else:
			start = cutoff_today
			end = add_to_date(cutoff_today, days=1)
	else:
		start = get_datetime(f"{today()} 00:00:00")
		end = add_to_date(start, days=1)
	return start, end


@frappe.whitelist(methods=["GET"])
def get_shift_metrics(branch=None):
	branch = _resolve_scoped_branch(branch)
	cache_key = f"ury_dashboard_shift_metrics:{branch}"
	cached = frappe.cache().get_value(cache_key)
	if cached:
		return cached

	start, end = _business_day_bounds(branch)

	conditions = "b.`docstatus` = 1 AND b.`status` IN ('Consolidated', 'Paid') AND TIMESTAMP(b.`posting_date`, b.`posting_time`) BETWEEN %(start)s AND %(end)s"
	params = {"start": start, "end": end}
	if branch:
		conditions += " AND b.`branch` = %(branch)s"
		params["branch"] = branch

	row = frappe.db.sql(
		f"""
		SELECT
			COUNT(b.`name`) AS invoice_count,
			ROUND(SUM(b.`grand_total`), 2) AS sales,
			SUM(b.`no_of_pax`) AS covers
		FROM `tabPOS Invoice` b
		WHERE {conditions}
		""",
		params,
		as_dict=True,
	)[0]

	sales = row.sales or 0
	covers = row.covers or 0
	avg_per_cover = round(sales / covers, 2) if covers else 0

	result = {
		"sales": sales,
		"covers": covers,
		"avg_per_cover": avg_per_cover,
	}

	frappe.cache().set_value(cache_key, result, expires_in_sec=60)
	return result


@frappe.whitelist(methods=["GET"])
def get_baseline(branch=None, weeks=6):
	branch = _resolve_scoped_branch(branch)
	weekday = get_datetime().weekday()
	hour = get_datetime().hour
	cache_key = f"ury_dashboard_baseline:{branch}:{weekday}:{hour}"
	cached = frappe.cache().get_value(cache_key)
	if cached:
		return cached

	conditions = """
		b.`docstatus` = 1
		AND b.`status` IN ('Consolidated', 'Paid')
		AND WEEKDAY(b.`posting_date`) = %(weekday)s
		AND HOUR(b.`posting_time`) BETWEEN %(hour_low)s AND %(hour_high)s
		AND b.`posting_date` >= DATE_SUB(CURDATE(), INTERVAL %(weeks)s WEEK)
		AND b.`posting_date` < CURDATE()
	"""
	params = {
		"weekday": weekday,
		"hour_low": max(hour - 1, 0),
		"hour_high": min(hour + 1, 23),
		"weeks": weeks,
	}
	if branch:
		conditions += " AND b.`branch` = %(branch)s"
		params["branch"] = branch

	rows = frappe.db.sql(
		f"""
		SELECT b.`posting_date` AS d, SUM(b.`grand_total`) AS sales, COUNT(b.`name`) AS covers
		FROM `tabPOS Invoice` b
		WHERE {conditions}
		GROUP BY b.`posting_date`
		ORDER BY b.`posting_date`
		""",
		params,
		as_dict=True,
	)

	sales_values = sorted([r.sales or 0 for r in rows])
	covers_values = sorted([r.covers or 0 for r in rows])

	def median(values):
		n = len(values)
		if not n:
			return 0
		mid = n // 2
		if n % 2:
			return values[mid]
		return round((values[mid - 1] + values[mid]) / 2, 2)

	result = {
		"sample_days": len(rows),
		"median_sales": median(sales_values),
		"median_covers": median(covers_values),
	}

	frappe.cache().set_value(cache_key, result, expires_in_sec=300)
	return result
