# Copyright (c) 2026, Tridz Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt
#
# Which sidebar nav items are hidden site-wide (e.g. "Mesa"/"Sala" for a
# delivery-only restaurant with no dine-in). One global setting, not
# per-branch or per-user — matches how this app's business model is
# configured once at the company level, not per staff member.

import json

import frappe
from frappe import _

_MANAGER_ROLES = {"URY Manager", "URY Admin", "System Manager"}

# Keys the frontend is allowed to hide. Kept in sync by hand with
# frontend/src/components/layout/Sidebar.tsx's NAV_ITEMS/SETTINGS_ITEMS -
# an unknown key is silently ignored rather than trusted, so a stale/bogus
# value saved here can never hide something this list doesn't expect.
HIDEABLE_ITEMS = {
    "delivery-orders",
    "menu",
    "stock",
    "table",
    "room",
    "branch",
    "branding",
    "pos-profile",
    "user",
    "aggregator",
    "report-settings",
    "production-unit",
}


@frappe.whitelist()
def get_hidden_sidebar_items():
    """Any logged-in user may read this - it's just which nav items to
    render, not sensitive data, and the dashboard itself is already gated
    to URY Manager by the frontend's RoleGuard."""
    raw = frappe.db.get_single_value("URY Sidebar Settings", "hidden_items")
    if not raw:
        return []
    try:
        items = json.loads(raw)
    except (TypeError, ValueError):
        return []
    return [i for i in items if i in HIDEABLE_ITEMS]


@frappe.whitelist(methods=["POST"])
def update_hidden_sidebar_items(hidden_items):
    if frappe.session.user != "Administrator" and not _MANAGER_ROLES.intersection(frappe.get_roles()):
        frappe.throw(_("Not permitted to change sidebar settings"), frappe.PermissionError)

    if isinstance(hidden_items, str):
        hidden_items = json.loads(hidden_items)
    if not isinstance(hidden_items, list):
        frappe.throw(_("hidden_items must be a list"))

    cleaned = sorted({str(i) for i in hidden_items if i in HIDEABLE_ITEMS})
    frappe.db.set_single_value("URY Sidebar Settings", "hidden_items", json.dumps(cleaned))
    return cleaned
