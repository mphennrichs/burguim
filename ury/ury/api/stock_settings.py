# Copyright (c) 2026, Tridz Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt
#
# Whether a sale is blocked when the item being sold doesn't have enough
# already-produced batch stock left - see ury.ury.api.stock_deduction,
# which reads this same setting at sale time. One global setting, not
# per-branch, matching URY Sidebar Settings.

import frappe
from frappe import _

_MANAGER_ROLES = {"URY Manager", "URY Admin", "System Manager"}


@frappe.whitelist()
def get_stock_settings():
    """Any logged-in user may read this - it only affects a toast message
    at checkout time, not sensitive data."""
    return {
        "block_sale_on_insufficient_stock": bool(
            frappe.db.get_single_value("URY Stock Settings", "block_sale_on_insufficient_stock")
        )
    }


@frappe.whitelist(methods=["POST"])
def update_stock_settings(block_sale_on_insufficient_stock):
    if frappe.session.user != "Administrator" and not _MANAGER_ROLES.intersection(frappe.get_roles()):
        frappe.throw(_("Not permitted to change stock settings"), frappe.PermissionError)

    value = str(block_sale_on_insufficient_stock).lower() in ("1", "true", "yes")
    frappe.db.set_single_value("URY Stock Settings", "block_sale_on_insufficient_stock", 1 if value else 0)
    return {"block_sale_on_insufficient_stock": bool(value)}
