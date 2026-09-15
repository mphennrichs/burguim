# Copyright (c) 2026, Tridz Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt
#
# Restaurant-level branding (today: just the logo). Stored on the native
# ERPNext `Company.company_logo` field rather than a new doctype field —
# it's already exactly the right shape (Attach Image) and every other
# part of the framework that already renders a company logo (print
# formats, etc.) picks it up for free.

import frappe
from frappe import _

from ury.ury_pos.api import getBranch

_MANAGER_ROLES = {"URY Manager", "URY Admin", "System Manager"}


def _resolve_company():
    company = frappe.defaults.get_global_default("company")
    if company and frappe.db.exists("Company", company):
        return company
    return frappe.db.get_value("Company", {}, "name")


def get_logo_url():
    """Not whitelisted on its own — used by self_ordering.py (guest
    context) and get_logo() (staff) so both stay in sync with a single
    resolution path.
    """
    company = _resolve_company()
    return frappe.db.get_value("Company", company, "company_logo") if company else None


@frappe.whitelist()
def get_logo():
    getBranch()
    return {"logo_url": get_logo_url()}


@frappe.whitelist()
def set_logo(file_url):
    branch = getBranch()
    if frappe.session.user != "Administrator" and not _MANAGER_ROLES.intersection(frappe.get_roles()):
        frappe.throw(_("Not permitted to change branding"), frappe.PermissionError)

    company = _resolve_company()
    if not company:
        frappe.throw(_("No company configured for branch {0}").format(branch))

    frappe.db.set_value("Company", company, "company_logo", file_url)
    frappe.db.commit()
    return {"logo_url": file_url}
