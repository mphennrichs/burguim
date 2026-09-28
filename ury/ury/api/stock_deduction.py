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


def compute_deduction_rows_and_shortfalls(cart_items, branch):
    """Shared by deduct_stock_on_sale() (on_submit) and caixa.py's
    pre-creation stock check - same "explode each sold line into real
    ingredients, aggregate, then check FEFO availability" computation,
    just without committing anything. `cart_items` is any iterable of
    objects/dicts with `item_code`/`qty` (a saved POS Invoice Item row or
    a plain {"item_code":..., "qty":...} dict from an unsaved cart both
    work). Returns (rows, shortfalls) - `rows` is the Material Issue line
    shape deduct_stock_on_sale inserts as-is; `shortfalls` is a list of
    (item_code, missing_qty) pairs.

    Aggregated across every line first (rather than resolved line by
    line) so two products sharing an ingredient - e.g. two different
    burgers both using Pão Brioche - draw from a single correctly-
    shrinking pool instead of each independently seeing the full
    pre-sale quantity as available.
    """
    needed = {}
    for row in cart_items:
        item_code = row.get("item_code") if isinstance(row, dict) else row.item_code
        sold_qty = flt(row.get("qty") if isinstance(row, dict) else row.qty)
        if sold_qty <= 0:
            continue
        for ingredient_code, ingredient_qty in _resolve_deductible_ingredients(item_code, sold_qty):
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

    return rows, shortfalls


def compute_max_sellable_qty(item_code, branch):
    """How many whole units of `item_code` real stock can support right
    now, and which ingredient caps it - same FEFO resolution as
    compute_deduction_rows_and_shortfalls, just expressed as a ratio
    (available / needed-per-unit) instead of a shortfall for one
    specific cart quantity. Lets the Caixa's item picker disable a "+"
    once the CART quantity itself reaches the real limit, not just when
    the item has zero stock left. Returns (None, None) when the item has
    no stock model at all (nothing to deduct - so it's never limited)."""
    needed = {}
    for ingredient_code, qty_per_unit in _resolve_deductible_ingredients(item_code, 1):
        needed[ingredient_code] = needed.get(ingredient_code, 0) + qty_per_unit
    if not needed:
        return None, None

    max_qty = None
    limiting_ingredient = None
    for ingredient_code, qty_per_unit in needed.items():
        if qty_per_unit <= 0:
            continue
        warehouse = _resolve_warehouse(ingredient_code, branch)
        available = sum(flt(b.qty) for b in _available_batches(ingredient_code, warehouse)) if warehouse else 0
        possible = available / qty_per_unit
        if max_qty is None or possible < max_qty:
            max_qty = possible
            limiting_ingredient = ingredient_code
    return max_qty, limiting_ingredient


def format_shortfalls(shortfalls):
    details = ", ".join(f"{item_code} (faltam {flt(qty)})" for item_code, qty in shortfalls)
    return frappe._(
        "Estoque insuficiente para: {0}. Desative \"Bloquear venda sem estoque suficiente\" em "
        "Configurações de Estoque se quiser vender mesmo assim."
    ).format(details)


def deduct_stock_for_order(cart_items, branch, invoice_name):
    """Deducts real stock for a batch of order lines RIGHT NOW - at order
    creation (caixa.create_manual_order) or confirmation (self_ordering.
    add_customer_items), not at pickup/delivery. Same aggregated FEFO
    computation as deduct_stock_on_sale, just running earlier and tagging
    the resulting Stock Entry with `custom_source_invoice` so:
      - a later cancellation (kitchen._finalize_cancelled_order) can find
        and reverse exactly what THIS call took (reverse_stock_for_order);
      - deduct_stock_on_sale's on_submit hook can tell this order's stock
        was already committed and must not deduct it again.

    Runs inside the caller's own request transaction - frappe.throw() here
    (insufficient stock, blocking enabled) unwinds the whole request,
    including whatever `invoice.save()` the caller already did, exactly
    like deduct_stock_on_sale already unwinds a submit today. `cart_items`
    should be only the lines just being added in THIS call, never the
    invoice's full item history - self_ordering's add_customer_items can
    be called more than once per invoice (a running table ordering a
    second round), and each call must only deduct its own increment.
    """
    block = _should_block_on_insufficient_stock()
    rows, shortfalls = compute_deduction_rows_and_shortfalls(cart_items, branch)

    if shortfalls and block:
        frappe.throw(format_shortfalls(shortfalls))

    if not rows:
        return

    entry = frappe.get_doc({
        "doctype": "Stock Entry",
        "stock_entry_type": "Material Issue",
        "purpose": "Material Issue",
        "custom_source_invoice": invoice_name,
        "items": rows,
    })
    entry.insert(ignore_permissions=True)
    entry.submit()


def reverse_stock_for_order(invoice_name):
    """Puts back every ingredient deduct_stock_for_order() already took for
    this invoice - there can be more than one Material Issue (one per
    self-ordering "round") - as a Material Receipt mirroring each one's
    exact item/batch/qty (t_warehouse = the original s_warehouse), so FEFO/
    expiry tracking isn't disturbed. Never re-queries availability (that's
    an Issue concept, meaningless for a Receipt putting stock back)."""
    issue_names = frappe.get_all(
        "Stock Entry",
        filters={"custom_source_invoice": invoice_name, "docstatus": 1, "stock_entry_type": "Material Issue"},
        pluck="name",
    )
    for issue_name in issue_names:
        issue = frappe.get_doc("Stock Entry", issue_name)
        rows = [{
            "item_code": row.item_code,
            "qty": row.qty,
            "t_warehouse": row.s_warehouse,
            "use_serial_batch_fields": 1,
            "batch_no": row.batch_no,
        } for row in issue.items]
        if not rows:
            continue
        entry = frappe.get_doc({
            "doctype": "Stock Entry",
            "stock_entry_type": "Material Receipt",
            "purpose": "Material Receipt",
            "items": rows,
        })
        entry.insert(ignore_permissions=True)
        entry.submit()


def deduct_stock_on_sale(doc, method):
    # A cancelled Pedido's stock impact (if any) is resolved explicitly by
    # kitchen.cancel_kitchen_order()/resolve_cancelled_order() before this
    # submit ever happens - never re-derived here from doc.items, which
    # would double-count (or wrongly deduct a "devolver ao estoque"
    # cancellation that should have zero stock impact).
    if getattr(doc, "custom_kitchen_status", None) == "Cancelado":
        return

    # A Pedido created/confirmed after deduct_stock_for_order() went live
    # already committed its own stock at order time - this submit is just
    # the pickup/delivery handoff confirmation, not a second sale. Only a
    # legacy Pedido (drafted before that existed) has no such Stock Entry
    # and still falls through to deducting here, same as always.
    if frappe.db.exists("Stock Entry", {"custom_source_invoice": doc.name, "docstatus": 1}):
        return

    branch = getattr(doc, "branch", None)
    block = _should_block_on_insufficient_stock()

    rows, shortfalls = compute_deduction_rows_and_shortfalls(doc.items, branch)

    if shortfalls and block:
        frappe.throw(format_shortfalls(shortfalls))

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
