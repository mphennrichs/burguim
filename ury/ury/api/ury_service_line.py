import frappe

from frappe.utils import get_datetime, add_to_date, today
from ury.ury_pos.api import getBranch


def _resolve_scoped_branch(branch):
	"""Administrator/System Manager may request any branch or the global
	aggregate (branch=None); everyone else is confined to their own branch
	(getBranch()), regardless of what they pass."""
	if frappe.session.user == "Administrator" or "System Manager" in frappe.get_roles():
		return branch
	return getBranch()


@frappe.whitelist(methods=["GET"])
def get_running_low(branch=None):
	branch = _resolve_scoped_branch(branch)
	cache_key = f"ury_dashboard_running_low:{branch}"
	cached = frappe.cache().get_value(cache_key)
	if cached:
		return cached

	warehouse = None
	if branch:
		pos_profile = frappe.db.get_value("POS Profile", {"branch": branch}, "warehouse")
		warehouse = pos_profile

	shift_start = get_datetime(f"{today()} 00:00:00")
	hours_elapsed = max((get_datetime() - shift_start).total_seconds() / 3600, 0.5)

	sold_conditions = "inv.`docstatus` = 1 AND inv.`posting_date` = CURDATE() AND item.`is_stock_item` = 1"
	sold_params = {}
	if branch:
		sold_conditions += " AND inv.`branch` = %(branch)s"
		sold_params["branch"] = branch

	sold_rows = frappe.db.sql(
		f"""
		SELECT ii.`item_code` AS item_code, ii.`item_name` AS item_name, SUM(ii.`qty`) AS qty_sold
		FROM `tabPOS Invoice Item` ii
		JOIN `tabPOS Invoice` inv ON inv.`name` = ii.`parent`
		JOIN `tabItem` item ON item.`name` = ii.`item_code`
		WHERE {sold_conditions}
		GROUP BY ii.`item_code`, ii.`item_name`
		HAVING qty_sold > 0
		ORDER BY qty_sold DESC
		LIMIT 20
		""",
		sold_params,
		as_dict=True,
	)

	result = []
	for row in sold_rows:
		bin_filters = {"item_code": row.item_code}
		if warehouse:
			bin_filters["warehouse"] = warehouse
		actual_qty = frappe.db.get_value("Bin", bin_filters, "sum(actual_qty)") or 0

		data_quality_issue = actual_qty < 0
		remaining = max(actual_qty, 0)

		sell_rate_per_hour = row.qty_sold / hours_elapsed
		eta_minutes = round((remaining / sell_rate_per_hour) * 60) if sell_rate_per_hour > 0 else None

		result.append({
			"item_code": row.item_code,
			"item_name": row.item_name,
			"remaining": remaining,
			"qty_sold_today": row.qty_sold,
			"eta_minutes": eta_minutes,
			"data_quality_issue": data_quality_issue,
		})

	result.sort(key=lambda r: (r["eta_minutes"] is None, r["eta_minutes"]))

	frappe.cache().set_value(cache_key, result[:6], expires_in_sec=60)
	return result[:6]
