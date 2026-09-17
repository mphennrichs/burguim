# Copyright (c) 2026, Tridz Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt
#
# In-app BOM (recipe) creation for "Meu Estoque" - before this, a BOM
# could only be created through raw Frappe Desk (/app/bom/new), which is
# how get_menu_cost_overview/get_production_items already expected recipes
# to exist. This just gives staff a form for the same thing: pick a
# batch-tracked item, list what it's made of, submit a BOM.

import frappe
from frappe import _
from frappe.utils import flt

from ury.ury_pos.api import getBranch
from ury.ury.api.branding import _resolve_company


@frappe.whitelist()
def get_bom_candidates():
    """Batch-tracked items - the only ones with real stock tracking in
    this system (see get_purchasable_items/get_production_items) - usable
    either as a BOM's output or as one of its ingredients."""
    getBranch()
    items = frappe.get_all(
        "Item",
        filters={"has_batch_no": 1, "disabled": 0},
        fields=["name", "item_name", "stock_uom"],
        order_by="item_name asc",
    )
    return {"items": items}


@frappe.whitelist()
def get_boms():
    """Existing default/active recipes, with their ingredient rows, for
    the "receitas cadastradas" list."""
    getBranch()
    boms = frappe.get_all(
        "BOM",
        filters={"docstatus": 1, "is_active": 1, "is_default": 1},
        fields=["name", "item", "item_name", "quantity", "uom"],
        order_by="item_name asc",
    )
    for bom in boms:
        bom["ingredients"] = frappe.get_all(
            "BOM Item",
            filters={"parent": bom.name},
            fields=["item_code", "item_name", "qty", "uom"],
            order_by="idx asc",
        )
    return {"boms": boms}


@frappe.whitelist(methods=["POST"])
def create_bom(item_code, quantity, ingredients):
    branch = getBranch()
    company = _resolve_company(branch)

    quantity = flt(quantity)
    if quantity <= 0:
        frappe.throw(_("Rendimento deve ser maior que zero"))

    if isinstance(ingredients, str):
        ingredients = frappe.parse_json(ingredients)

    rows = []
    for row in ingredients or []:
        ing_qty = flt(row.get("qty"))
        if ing_qty <= 0:
            continue
        rows.append({"item_code": row["item_code"], "qty": ing_qty})
    if not rows:
        frappe.throw(_("Adicione pelo menos um ingrediente"))
    if any(row["item_code"] == item_code for row in rows):
        frappe.throw(_("Um item não pode ser ingrediente da própria receita"))

    currency = frappe.get_cached_value("Company", company, "default_currency")

    bom = frappe.get_doc({
        "doctype": "BOM",
        "item": item_code,
        "company": company,
        "currency": currency,
        "quantity": quantity,
        "is_active": 1,
        "is_default": 1,
        "with_operations": 0,
        "items": rows,
    })
    bom.insert(ignore_permissions=True)
    bom.submit()
    frappe.db.commit()

    return {"bom": bom.name}
