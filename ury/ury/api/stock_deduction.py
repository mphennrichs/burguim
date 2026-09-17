# Copyright (c) 2026, Tridz Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt
#
# Deducts stock automatically when an invoice is submitted (POS Invoice -
# both the staff `pos` app and guest self-order create these, see
# self_ordering.py; Sales Invoice is hooked too for completeness).
#
# Burguim assembles to order: a sold item like "Classic Burguim" isn't
# itself a stock item, it's a recipe (BOM) of parts - pão, carne, queijo,
# molho - each tracked with its own batch/expiry. Recipes also nest: a
# "Hambúrguer (pad)" sub-recipe (patinho + peito bovino) can itself be one
# ingredient inside "Classic Burguim"'s recipe. So a sold item is resolved
# to what should actually leave stock, recursively:
#   - if the item itself is batch-tracked (has_batch_no=1), it was
#     pre-produced ahead of time (e.g. a sauce made via record_production)
#     and its own batch is decremented directly - even if it also has a
#     BOM of its own, that BOM was already consumed when THAT batch was
#     produced, so it isn't re-exploded here;
#   - otherwise, if it has a default BOM, each ingredient row is resolved
#     the same way in turn (so a nested sub-recipe keeps unwinding until
#     it bottoms out at real batch-tracked items);
#   - otherwise there's nothing to deduct (no stock model for this item).
#
# This is a doc_event hook, so it runs inside the SAME transaction as the
# invoice submission - a frappe.throw() here aborts the whole sale, which
# is exactly the point of URY Stock Settings.block_sale_on_insufficient_stock.

import frappe
from frappe.utils import flt

from ury.ury.api.stock_entry import _resolve_warehouse


def _should_block_on_insufficient_stock():
    return bool(frappe.db.get_single_value("URY Stock Settings", "block_sale_on_insufficient_stock"))


def _resolve_default_bom(item_code):
    return frappe.db.get_value(
        "BOM", {"item": item_code, "is_active": 1, "is_default": 1, "docstatus": 1}, "name"
    )


def _resolve_deductible_ingredients(item_code, sold_qty, _chain=()):
    """What should actually leave stock for one sale of `item_code`, and
    how much of each - see module docstring for the pre-produced-batch
    vs. assembled-to-order distinction. Recurses through nested recipes;
    `_chain` guards against a cyclical BOM (shouldn't exist - BOM's own
    check_recursion refuses to save one - but this must never hang the
    checkout if one somehow does)."""
    if frappe.db.get_value("Item", item_code, "has_batch_no"):
        return [(item_code, sold_qty)]

    if item_code in _chain:
        return []

    bom_name = _resolve_default_bom(item_code)
    if not bom_name:
        return []

    bom = frappe.get_doc("BOM", bom_name)
    scale = sold_qty / flt(bom.quantity)
    chain = _chain + (item_code,)
    result = []
    for bom_item in bom.items:
        result.extend(_resolve_deductible_ingredients(bom_item.item_code, flt(bom_item.qty) * scale, chain))
    return result


def _available_batches(item_code, warehouse):
    """(batch_no, qty) pairs with stock on hand for this item in this
    warehouse, soonest-expiry first (FEFO) - same Serial and Batch Entry
    query stock_overview.get_expiring_batches already uses, since
    Stock Ledger Entry.batch_no isn't populated in this ERPNext version."""
    return frappe.db.sql(
        """
        SELECT b.name AS batch_no, COALESCE(SUM(sbe.qty), 0) AS qty
        FROM `tabBatch` b
        LEFT JOIN `tabSerial and Batch Entry` sbe ON sbe.batch_no = b.name
        LEFT JOIN `tabSerial and Batch Bundle` sbb ON sbb.name = sbe.parent
        WHERE b.item = %(item_code)s
            AND (sbb.warehouse IS NULL OR sbb.warehouse = %(warehouse)s)
            AND (sbb.name IS NULL OR (sbb.docstatus = 1 AND sbb.is_cancelled = 0))
        GROUP BY b.name
        HAVING qty > 0
        ORDER BY b.expiry_date ASC
        """,
        {"item_code": item_code, "warehouse": warehouse},
        as_dict=True,
    )


def deduct_stock_on_sale(doc, method):
    branch = getattr(doc, "branch", None)
    block = _should_block_on_insufficient_stock()

    # Aggregated across every sold line first (rather than deducted line by
    # line) so two products on the same invoice that share an ingredient -
    # e.g. two different burgers both using Pão Brioche - draw from a
    # single correctly-shrinking pool instead of each independently seeing
    # the full pre-sale quantity as available.
    needed = {}
    for row in doc.items:
        sold_qty = flt(row.qty)
        if sold_qty <= 0:
            continue
        for ingredient_code, ingredient_qty in _resolve_deductible_ingredients(row.item_code, sold_qty):
            needed[ingredient_code] = needed.get(ingredient_code, 0) + ingredient_qty

    rows = []
    shortfalls = []

    for item_code, total_qty in needed.items():
        warehouse = _resolve_warehouse(item_code, branch)
        if not warehouse:
            continue  # no depósito configured for this branch - can't resolve where to deduct from

        remaining = total_qty
        for batch in _available_batches(item_code, warehouse):
            if remaining <= 0:
                break
            take = min(remaining, flt(batch.qty))
            if take <= 0:
                continue
            rows.append({
                "item_code": item_code,
                "qty": take,
                "s_warehouse": warehouse,
                "use_serial_batch_fields": 1,
                "batch_no": batch.batch_no,
            })
            remaining -= take

        if remaining > 0:
            shortfalls.append((item_code, remaining))

    if shortfalls and block:
        details = ", ".join(f"{item_code} (faltam {flt(qty)})" for item_code, qty in shortfalls)
        frappe.throw(
            frappe._("Estoque insuficiente para: {0}. Desative \"Bloquear venda sem estoque suficiente\" em Configurações de Estoque se quiser vender mesmo assim.").format(details)
        )

    if not rows:
        return

    entry = frappe.get_doc({
        "doctype": "Stock Entry",
        "stock_entry_type": "Material Issue",
        "purpose": "Material Issue",
        "items": rows,
    })
    entry.insert(ignore_permissions=True)
    entry.submit()
