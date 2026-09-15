import frappe


def check_app_permission():
	if frappe.session.user == "Administrator" or "System Manager" in frappe.get_roles():
		return True


# ---------------------------------------------------------------------------
# Branch-level access control (permission_query_conditions / has_permission
# hooks, registered in hooks.py).
#
# Several staff-facing endpoints (ury/ury/api/delivery_orders.py,
# stock_overview.py, ...) already assume a logged-in user only ever needs
# their own branch's data, and filter accordingly. That assumption held only
# as long as every caller went through those endpoints — a security review
# confirmed any authenticated user could bypass it entirely via Frappe's own
# generic API (frappe.client.get_list/get_value/set_value), reading and
# writing another branch's POS Invoices and every Customer's saved phone
# number/address, regardless of role. These hooks enforce the same rule at
# the doctype level, so it holds no matter which door a caller uses.
# ---------------------------------------------------------------------------

def _is_privileged(user=None):
	user = user or frappe.session.user
	return user == "Administrator" or "System Manager" in frappe.get_roles(user)


def _resolve_user_branch(user=None):
	"""Same URY User -> Branch resolution as ury_pos.api.getBranch(), but
	returns None instead of throwing for a user with no branch — callers
	here need to *deny*, not crash, when that happens."""
	user = user or frappe.session.user
	rows = frappe.db.sql(
		"""
		SELECT b.branch
		FROM `tabURY User` AS a
		INNER JOIN `tabBranch` AS b ON a.parent = b.name
		WHERE a.user = %s
		""",
		user,
		as_dict=True,
	)
	return rows[0].branch if rows else None


def _flat_branch_query_conditions(table, user):
	"""Shared by every doctype below that has its own `branch` Link field
	directly on the table — the common case."""
	if _is_privileged(user):
		return ""
	branch = _resolve_user_branch(user)
	if not branch:
		return "1=0"
	return f"`tab{table}`.branch = {frappe.db.escape(branch)}"


def _flat_branch_has_permission(doc, user):
	if _is_privileged(user):
		return None
	branch = _resolve_user_branch(user)
	if not branch or doc.branch != branch:
		return False
	return None


# --- POS Invoice ---

def pos_invoice_query_conditions(user, doctype=None):
	return _flat_branch_query_conditions("POS Invoice", user)


def pos_invoice_has_permission(doc, ptype, user, debug=False):
	return _flat_branch_has_permission(doc, user)


# --- URY Table, URY KOT, POS Opening Entry, Sales Invoice ---
# Same rule as POS Invoice, same reasoning — a security re-test after the
# first pass of fixes found these had the identical flat role grant (no
# `match`/scoping at all) as POS Invoice originally did, just not yet
# exploitable live because only one branch exists today. Each has its own
# `branch` field, so the same flat-field helper covers all four.

def ury_table_query_conditions(user, doctype=None):
	return _flat_branch_query_conditions("URY Table", user)


def ury_table_has_permission(doc, ptype, user, debug=False):
	return _flat_branch_has_permission(doc, user)


def ury_kot_query_conditions(user, doctype=None):
	return _flat_branch_query_conditions("URY KOT", user)


def ury_kot_has_permission(doc, ptype, user, debug=False):
	return _flat_branch_has_permission(doc, user)


def pos_opening_entry_query_conditions(user, doctype=None):
	return _flat_branch_query_conditions("POS Opening Entry", user)


def pos_opening_entry_has_permission(doc, ptype, user, debug=False):
	return _flat_branch_has_permission(doc, user)


def sales_invoice_query_conditions(user, doctype=None):
	return _flat_branch_query_conditions("Sales Invoice", user)


def sales_invoice_has_permission(doc, ptype, user, debug=False):
	return _flat_branch_has_permission(doc, user)


# --- URY Daily P and L ---
# Only role-gated by default (URY Manager/URY Admin/System Manager have
# read), no branch scoping — a report_api sweep found its whitelisted
# get_proft_loss_details() document method (and the JSON equivalents in
# report_api/financial.py, fixed separately via require_manager()'s new
# branch override) let a manager of one branch view another branch's full
# P&L just by knowing/guessing the document name.

def daily_pnl_query_conditions(user, doctype=None):
	return _flat_branch_query_conditions("URY Daily P and L", user)


def daily_pnl_has_permission(doc, ptype, user, debug=False):
	return _flat_branch_has_permission(doc, user)


# --- POS Closing Entry ---
# No branch field of its own — scoped one hop out, via its pos_profile's
# branch (same shape as URY Ordering Session below).

def pos_closing_entry_query_conditions(user, doctype=None):
	if _is_privileged(user):
		return ""
	branch = _resolve_user_branch(user)
	if not branch:
		return "1=0"
	escaped = frappe.db.escape(branch)
	return (
		"`tabPOS Closing Entry`.pos_profile in ("
		f"select name from `tabPOS Profile` where branch = {escaped}"
		")"
	)


def pos_closing_entry_has_permission(doc, ptype, user, debug=False):
	if _is_privileged(user):
		return None
	branch = _resolve_user_branch(user)
	if not branch:
		return False
	profile_branch = frappe.db.get_value("POS Profile", doc.pos_profile, "branch")
	if profile_branch != branch:
		return False
	return None


# --- URY Ordering Session (self-order guest sessions) ---
# No branch field of its own — scoped one hop out, via the branch of the
# URY Self Ordering Profile it belongs to.

def ordering_session_query_conditions(user, doctype=None):
	if _is_privileged(user):
		return ""
	branch = _resolve_user_branch(user)
	if not branch:
		return "1=0"
	escaped = frappe.db.escape(branch)
	return (
		"`tabURY Ordering Session`.ordering_profile in ("
		f"select name from `tabURY Self Ordering Profile` where branch = {escaped}"
		")"
	)


def ordering_session_has_permission(doc, ptype, user, debug=False):
	if _is_privileged(user):
		return None
	branch = _resolve_user_branch(user)
	if not branch:
		return False
	profile_branch = frappe.db.get_value("URY Self Ordering Profile", doc.ordering_profile, "branch")
	if profile_branch != branch:
		return False
	return None


# --- Customer ---
# Customer has no branch field and legitimately spans branches of the same
# business (a repeat customer can order from more than one location, and a
# manager may need to look up an order placed elsewhere) — a hard branch
# match here would break real usage, not just close a gap. What the
# security review actually exploited was that ANY authenticated Frappe
# user, including one with no real role in this restaurant at all, could
# bulk-read every customer's phone number and delivery address. Requiring
# real URY staff membership (the same URY User link every branch check in
# this app relies on) closes that gap without restricting legitimate
# cross-branch lookups staff already rely on.

def customer_query_conditions(user, doctype=None):
	if _is_privileged(user):
		return ""
	if frappe.db.exists("URY User", {"user": user}):
		return ""
	return "1=0"


def customer_has_permission(doc, ptype, user, debug=False):
	if _is_privileged(user):
		return None
	if frappe.db.exists("URY User", {"user": user}):
		return None
	return False
