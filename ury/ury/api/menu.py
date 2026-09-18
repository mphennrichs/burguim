# Copyright (c) 2026, Tridz Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt
#
# Category (URY Menu Course) rename/delete for the Cardápio screen -
# creation already existed (frontend calls frappe.client.insert directly),
# but there was no way to rename or remove one afterwards.

import frappe
from frappe import _

from ury.ury_pos.api import getBranch


@frappe.whitelist(methods=["POST"])
def rename_course(old_name, new_name, icon=None):
    """URY Menu Item.course is a real Link to URY Menu Course (so is URY
    KOT Items.course), so frappe.rename_doc's own update_linked_doctypes
    pass already repoints every menu item/kitchen ticket that referenced
    the old name - no manual cascade needed here. Sales/POS Invoice
    Item.custom_course are separate plain-text fields on historical
    invoice rows and are deliberately left alone - a past order keeps
    whatever category name was true when it was placed."""
    getBranch()
    new_name = (new_name or "").strip()
    if not new_name:
        frappe.throw(_("Informe um nome para a categoria"))

    if new_name != old_name:
        if frappe.db.exists("URY Menu Course", new_name):
            frappe.throw(_("Já existe uma categoria chamada {0}").format(new_name))
        frappe.rename_doc("URY Menu Course", old_name, new_name, ignore_permissions=True)

    if icon is not None:
        frappe.db.set_value("URY Menu Course", new_name, "icon", icon)

    frappe.db.commit()
    return {"name": new_name}


@frappe.whitelist(methods=["POST"])
def delete_course(course_name):
    getBranch()
    menu_item_count = frappe.db.count("URY Menu Item", {"course": course_name})
    kot_count = frappe.db.count("URY KOT Items", {"course": course_name})
    if menu_item_count or kot_count:
        parts = []
        if menu_item_count:
            parts.append(_("{0} item(ns) do cardápio").format(menu_item_count))
        if kot_count:
            parts.append(_("{0} pedido(s) já feito(s)").format(kot_count))
        frappe.throw(
            _("Não é possível excluir: {0} ainda usam essa categoria.").format(" e ".join(parts))
        )

    try:
        frappe.delete_doc("URY Menu Course", course_name, ignore_permissions=True)
    except frappe.LinkExistsError:
        frappe.clear_messages()
        frappe.throw(_("Não é possível excluir: essa categoria ainda está em uso."))

    frappe.db.commit()
    return {"deleted": course_name}
