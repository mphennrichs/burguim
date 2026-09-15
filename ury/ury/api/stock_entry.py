# Copyright (c) 2026, Tridz Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt
#
# Staff-facing "I just bought this" flow — records a real Material
# Receipt Stock Entry (with a batch + expiry date) for a raw-material
# ingredient, so "Meu Estoque" has real stock/validity data to show
# instead of an always-empty list. Also keeps the Buying Item Price
# current, since the recursive BOM cost engine (ury_daily_p_and_l.py,
# stock_overview.py) reads cost from there, not from the Stock Entry.

import frappe
from frappe import _
from frappe.utils import add_days, cint, flt, getdate, nowdate

from ury.ury_pos.api import getBranch
from ury.ury.api.branding import _resolve_company


def _resolve_warehouse(item_code, branch):
    company = _resolve_company(branch)
    warehouse = frappe.db.get_value(
        "Item Default", {"parent": item_code, "company": company}, "default_warehouse"
    )
    if warehouse:
        return warehouse
    pos_profile = frappe.db.get_value("POS Profile", {"branch": branch}, "name")
    return frappe.db.get_value("POS Profile", pos_profile, "warehouse") if pos_profile else None


@frappe.whitelist()
def get_purchasable_items():
    """Raw-material items this branch can log a purchase for — anything
    batch-tracked, which is exactly how the ingredients were set up when
    "Meu Estoque" first went in (see the BOM/cost work earlier)."""
    getBranch()
    items = frappe.get_all(
        "Item",
        filters={"has_batch_no": 1, "disabled": 0},
        fields=["name", "item_name", "stock_uom", "shelf_life_in_days"],
        order_by="item_name asc",
    )
    for item in items:
        item["last_buying_rate"] = frappe.db.get_value(
            "Item Price", {"item_code": item.name, "price_list": "Standard Buying"}, "price_list_rate"
        )
    return {"items": items}


@frappe.whitelist(methods=["POST"])
def record_purchase(item_code, qty, rate, purchase_date=None, expiry_date=None):
    branch = getBranch()

    qty = flt(qty)
    rate = flt(rate)
    if qty <= 0:
        frappe.throw(_("Quantidade deve ser maior que zero"))
    if rate <= 0:
        frappe.throw(_("Preço deve ser maior que zero"))

    item = frappe.get_doc("Item", item_code)
    if not item.has_batch_no:
        frappe.throw(_("Item {0} não controla lote/validade").format(item_code))

    warehouse = _resolve_warehouse(item_code, branch)
    if not warehouse:
        frappe.throw(_("Nenhum depósito configurado para esta filial"))

    purchase_date = getdate(purchase_date) if purchase_date else getdate(nowdate())

    if expiry_date:
        expiry_date = getdate(expiry_date)
    elif item.shelf_life_in_days:
        expiry_date = add_days(purchase_date, cint(item.shelf_life_in_days))
    else:
        expiry_date = None

    # Created explicitly (rather than left for Stock Entry's own
    # create_new_batch auto-naming) since Batch.autoname is
    # "field:batch_id" and none of these items have a
    # batch_number_series configured — auto-creation would have nothing
    # to generate a name from.
    batch = frappe.get_doc({
        "doctype": "Batch",
        "batch_id": f"{item_code}-{purchase_date.isoformat()}-{frappe.generate_hash(length=4)}",
        "item": item_code,
        "manufacturing_date": purchase_date,
        "expiry_date": expiry_date,
    })
    batch.insert(ignore_permissions=True)

    entry = frappe.get_doc({
        "doctype": "Stock Entry",
        "stock_entry_type": "Material Receipt",
        "posting_date": purchase_date,
        "items": [{
            "item_code": item_code,
            "qty": qty,
            "basic_rate": rate,
            "t_warehouse": warehouse,
            "use_serial_batch_fields": 1,
            "batch_no": batch.name,
        }],
    })
    entry.insert(ignore_permissions=True)
    entry.submit()
    batch_no = batch.name

    price_name = frappe.db.get_value(
        "Item Price", {"item_code": item_code, "price_list": "Standard Buying"}, "name"
    )
    if price_name:
        frappe.db.set_value("Item Price", price_name, "price_list_rate", rate)
    else:
        frappe.get_doc({
            "doctype": "Item Price",
            "item_code": item_code,
            "price_list": "Standard Buying",
            "price_list_rate": rate,
        }).insert(ignore_permissions=True)
    frappe.db.commit()

    return {
        "stock_entry": entry.name,
        "batch_no": batch_no,
        "qty": qty,
        "expiry_date": expiry_date,
    }


# ---------------------------------------------------------------------------
# Production — for items prepped in-house ahead of the order (e.g. Molho da
# Casa), not bought from a supplier. Consumes the item's own BOM ingredients
# and produces a new batch of the prepped item, via a native ERPNext
# Manufacture Stock Entry — the same cost-recursion engine the rest of "Meu
# Estoque" already relies on treats a prepped item exactly like a raw
# material once it has stock, so nothing else needs to change for it to show
# up correctly elsewhere.
# ---------------------------------------------------------------------------

def _resolve_default_bom(item_code):
    return frappe.db.get_value(
        "BOM", {"item": item_code, "is_active": 1, "is_default": 1, "docstatus": 1}, "name"
    )


@frappe.whitelist()
def get_production_items():
    """Items that are prepped in-house: batch-tracked (so a prep run gets
    its own expiry) AND have their own BOM (so there's a recipe to consume
    from) — distinct from get_purchasable_items, which is for raw
    ingredients bought as-is."""
    getBranch()
    items = frappe.get_all(
        "Item",
        filters={"has_batch_no": 1, "disabled": 0},
        fields=["name", "item_name", "stock_uom", "shelf_life_in_days"],
    )
    result = []
    for item in items:
        bom = _resolve_default_bom(item.name)
        if bom:
            item["bom"] = bom
            result.append(item)
    return {"items": result}


@frappe.whitelist(methods=["POST"])
def record_production(item_code, qty, purchase_date=None, expiry_date=None):
    branch = getBranch()

    qty = flt(qty)
    if qty <= 0:
        frappe.throw(_("Quantidade deve ser maior que zero"))

    item = frappe.get_doc("Item", item_code)
    if not item.has_batch_no:
        frappe.throw(_("Item {0} não controla lote/validade").format(item_code))

    bom_name = _resolve_default_bom(item_code)
    if not bom_name:
        frappe.throw(_("Item {0} não tem uma receita (BOM) cadastrada").format(item_code))
    bom = frappe.get_doc("BOM", bom_name)

    warehouse = _resolve_warehouse(item_code, branch)
    if not warehouse:
        frappe.throw(_("Nenhum depósito configurado para esta filial"))

    purchase_date = getdate(purchase_date) if purchase_date else getdate(nowdate())
    if expiry_date:
        expiry_date = getdate(expiry_date)
    elif item.shelf_life_in_days:
        expiry_date = add_days(purchase_date, cint(item.shelf_life_in_days))
    else:
        expiry_date = None

    output_batch = frappe.get_doc({
        "doctype": "Batch",
        "batch_id": f"{item_code}-{purchase_date.isoformat()}-{frappe.generate_hash(length=4)}",
        "item": item_code,
        "manufacturing_date": purchase_date,
        "expiry_date": expiry_date,
    })
    output_batch.insert(ignore_permissions=True)

    scale = qty / flt(bom.quantity)
    rows = []
    for bom_item in bom.items:
        ingredient_warehouse = _resolve_warehouse(bom_item.item_code, branch) or warehouse
        rows.append({
            "item_code": bom_item.item_code,
            "qty": flt(bom_item.qty) * scale,
            "s_warehouse": ingredient_warehouse,
            "is_finished_item": 0,
            "use_serial_batch_fields": 1,
        })
    rows.append({
        "item_code": item_code,
        "qty": qty,
        "t_warehouse": warehouse,
        "is_finished_item": 1,
        "use_serial_batch_fields": 1,
        "batch_no": output_batch.name,
    })

    entry = frappe.get_doc({
        "doctype": "Stock Entry",
        "stock_entry_type": "Manufacture",
        "purpose": "Manufacture",
        "bom_no": bom_name,
        "fg_completed_qty": qty,
        "posting_date": purchase_date,
        "items": rows,
    })
    entry.insert(ignore_permissions=True)
    entry.submit()

    return {
        "stock_entry": entry.name,
        "batch_no": output_batch.name,
        "qty": qty,
        "expiry_date": expiry_date,
    }
