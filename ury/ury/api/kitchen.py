# Copyright (c) 2026, Tridz Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt
#
# Backend for the Tela de Cozinha (CONTEXT.md) - replaces the old
# delivery-only queue (ury.ury.api.delivery_orders, deleted alongside this
# file's introduction): same staff-facing operational queue, but covering
# both Retirada and Entrega Pedidos together instead of filtering to
# order_type="Delivery" only. Every function here relies on Frappe's normal
# doctype permissions for the logged-in staff user (URY Cashier already has
# write/submit on POS Invoice - see patches/v2_0/default_permissions.py);
# nothing is elevated or guest-safe.

import frappe
from frappe import _
from frappe.utils import nowdate

from ury.ury_pos.api import getBranch, ensure_pos_opening_entry
from ury.ury.api.stock_deduction import (
    compute_deduction_rows_and_shortfalls,
    reverse_stock_for_order,
    _item_needs_prep,
    _invoice_tag,
)

# Estados do Pedido (CONTEXT.md) - shared "Na Fila"/"Preparando"/"Pronto"
# prefix (the kitchen finished montando, regardless of Modalidade), then
# the flow diverges only after that. Order in each list matters:
# advance_kitchen_status() only allows moving to the very next entry.
_COMMON_STATES = ["Na Fila", "Preparando", "Pronto"]
_FLOWS = {
    "Take Away": _COMMON_STATES + ["Retirado"],
    "Delivery": _COMMON_STATES + ["Saiu para Entrega", "Entregue"],
}
_TERMINAL_STATES = {"Retirado", "Entregue"}


def _flow_for(order_type):
    flow = _FLOWS.get(order_type)
    if not flow:
        frappe.throw(_("Unsupported order type for the kitchen queue: {0}").format(order_type))
    return flow


def _resolve_branch_currency_symbol(branch):
    """`frontend` (the admin SPA this powers) never populates the shared
    `currencySymbol` localStorage key the way `pos` does on its own staff
    login - every currency display across the whole app silently falls
    back to formatCurrency's hardcoded '₹' default (same root cause
    self_ordering.py's _resolve_currency_symbol fixed for self-order, and
    the old delivery_orders.py fixed for its own screen). Resolves it just
    for this page's own response.
    """
    pos_profile = frappe.db.get_value("POS Profile", {"branch": branch}, "name")
    currency = frappe.db.get_value("POS Profile", pos_profile, "currency") if pos_profile else None
    if not currency:
        return None
    return frappe.db.get_value("Currency", currency, "symbol") or currency


@frappe.whitelist()
def get_kitchen_queue():
    """Every not-yet-finished Pedido for the logged-in staff member's
    branch, oldest first - Retirada and Entrega together (the old
    delivery-only queue this replaces filtered to order_type="Delivery",
    which is exactly what made it Entrega-only) - plus today's already
    Entregue Pedidos, so the Kanban's "Entregue" column has something to
    show instead of always being empty (reaching that terminal state
    submits the invoice, which would otherwise drop it out of the queue
    entirely). Bounded to today (posting_date) so this column doesn't
    grow unbounded over time; there's no equivalent "Retirado" column
    today by design (not asked for) - the same query shape would cover
    it if that changes.

    A Pedido stays docstatus=0 for its whole trip through the active
    part of the queue; reaching the terminal state of its flow
    (Retirado/Entregue) submits it in advance_kitchen_status(), same as
    the old queue's "mark complete" - so "not yet finished" is just
    docstatus=0.
    """
    branch = getBranch()
    currency_symbol = _resolve_branch_currency_symbol(branch)

    fields = [
        "name",
        "customer",
        "customer_name",
        "shipping_address",
        "contact_mobile",
        "custom_comments",
        "creation",
        "order_type",
        "custom_kitchen_status",
        "grand_total",
    ]

    # frappe.get_all() defaults to limit_page_length=20 when not passed -
    # this is THE active queue (every not-yet-finished Pedido), which must
    # never be silently truncated: a busy night with more than 20 orders in
    # flight at once would just drop the newest ones off the Tela de
    # Cozinha with no error, no warning, nothing. Same for a single order's
    # own line items (a large order could plausibly have more than 20).
    invoices = frappe.get_all(
        "POS Invoice",
        filters={
            "docstatus": 0,
            "branch": branch,
            "order_type": ["in", list(_FLOWS.keys())],
        },
        fields=fields,
        order_by="creation asc",
        limit_page_length=0,
    )

    delivered_today = frappe.get_all(
        "POS Invoice",
        filters={
            "docstatus": 1,
            "branch": branch,
            "order_type": "Delivery",
            "custom_kitchen_status": "Entregue",
            "posting_date": nowdate(),
        },
        fields=fields,
        order_by="creation asc",
        limit_page_length=0,
    )

    orders = []
    for inv in invoices + delivered_today:
        items = frappe.get_all(
            "POS Invoice Item",
            filters={"parent": inv.name},
            fields=["item_name", "qty", "amount"],
            order_by="idx asc",
            limit_page_length=0,
        )
        orders.append({
            "invoice": inv.name,
            "customer_name": inv.customer_name or inv.customer,
            "order_type": inv.order_type,
            "delivery_address": inv.shipping_address,
            "delivery_phone": inv.contact_mobile,
            "notes": inv.custom_comments or None,
            "grand_total": inv.grand_total,
            "created_at": inv.creation,
            "kitchen_status": inv.custom_kitchen_status or _COMMON_STATES[0],
            "next_status": _next_status(inv.order_type, inv.custom_kitchen_status),
            "items": items,
        })

    return {"orders": orders, "currency_symbol": currency_symbol}


def _next_status(order_type, current_status):
    flow = _flow_for(order_type)
    current = current_status or flow[0]
    if current not in flow:
        return None
    idx = flow.index(current)
    return flow[idx + 1] if idx + 1 < len(flow) else None


@frappe.whitelist(methods=["POST"])
def advance_kitchen_status(invoice, new_status):
    """Move a Pedido to `new_status`, following the Estados flow for its
    own Modalidade (CONTEXT.md) - only the very next state in that flow is
    accepted, no skipping ahead and no moving backwards.

    Reaching the flow's terminal state (Retirado/Entregue) submits the
    invoice - payment was already registered against the branch's default
    Mode of Payment at invoice-creation time (same as the old
    mark_delivery_order_complete()), so submit() here is just the
    confirmation that the handoff actually happened, not a separate
    payment step.
    """
    branch = getBranch()
    doc = frappe.get_doc("POS Invoice", invoice)

    if doc.branch != branch:
        frappe.throw(_("Not permitted to update orders outside your branch"), frappe.PermissionError)
    if doc.docstatus != 0:
        frappe.throw(_("This order was already completed"), frappe.ValidationError)

    expected = _next_status(doc.order_type, doc.custom_kitchen_status)
    if not expected or new_status != expected:
        frappe.throw(
            _("Cannot move this order from {0} to {1}").format(
                doc.custom_kitchen_status or _COMMON_STATES[0], new_status
            ),
            frappe.ValidationError,
        )

    doc.custom_kitchen_status = new_status
    if new_status in _TERMINAL_STATES:
        # ERPNext's own POS Invoice submit requires an open POS Opening
        # Entry for the invoice's pos_profile - self-heal it here too
        # (not just in caixa.py's create_manual_order), since whoever
        # advances this order to its terminal state may be a different
        # session than whoever created it (e.g. a shift change).
        if doc.pos_profile:
            ensure_pos_opening_entry(doc.pos_profile)
        doc.submit()
    else:
        doc.save()

    return {"invoice": doc.name, "kitchen_status": new_status, "completed": new_status in _TERMINAL_STATES}


def _finalize_cancelled_order(doc, restock):
    """Submits a Cancelado Pedido - always submitted (not left a draft
    forever) so it lands permanently in Histórico de Vendas/Cliente, same
    as a normal completed order, just flagged Cancelado instead.

    `restock` only ever governs the items that actually needed prep
    (Produto/Preparo com Receita) - an item sold as-is (Refrigerante,
    has_batch_no=1) never got physically prepared, so it ALWAYS goes back
    to stock regardless of what the owner decides for the rest of a mixed
    Pedido (confirmed with the owner: the devolver/perda decision is per
    Pedido, but a resold item's own "always returns" guarantee must not
    get swallowed by a Receita item's "perda" in the same order).

    Stock impact depends on whether this Pedido already deducted its own
    ingredients at creation/confirmation (stock_deduction.
    deduct_stock_for_order, which itself splits Material Issues by
    custom_needs_prep for exactly this reason):
      - Already deducted (the normal case since that feature shipped): the
        resold-items entry always reverses; the needs-prep-items entry
        reverses only if `restock` (otherwise that original deduction
        already IS the loss - CONTEXT.md has no advance payment, so a
        cancelled Pedido that already consumed real ingredients is pure
        loss with zero revenue, "venda negativa", not a real sale).
      - Legacy Pedido (drafted before that feature shipped, nothing
        deducted yet): `restock` is a no-op (nothing to put back);
        `not restock` must record the loss NOW for the needs-prep items
        only (same resold-items-never-loss rule). Shortfalls are ignored
        in that legacy path (never blocks resolving the cancellation over
        a stock discrepancy that's a pre-existing problem, not this
        action's fault).
    """
    already_deducted = bool(frappe.db.exists(
        "Stock Entry",
        {"custom_source_invoice": _invoice_tag(doc.doctype, doc.name), "docstatus": 1, "stock_entry_type": "Material Issue"},
    ))

    if already_deducted:
        reverse_stock_for_order(doc.name, needs_prep=0)
        if restock:
            reverse_stock_for_order(doc.name, needs_prep=1)
    elif not restock:
        prep_items = [row for row in doc.items if _item_needs_prep(row.item_code)]
        rows, _shortfalls = compute_deduction_rows_and_shortfalls(prep_items, doc.branch)
        if rows:
            entry = frappe.get_doc({
                "doctype": "Stock Entry",
                "stock_entry_type": "Material Issue",
                "purpose": "Material Issue",
                "items": rows,
            })
            entry.insert(ignore_permissions=True)
            entry.submit()

    if doc.pos_profile:
        ensure_pos_opening_entry(doc.pos_profile)
    doc.submit()


@frappe.whitelist(methods=["POST"])
def cancel_kitchen_order(invoice):
    """Cancels a still-in-progress Pedido. Auto-resolves (no stock
    impact, submits immediately) when nothing could have been physically
    consumed yet: still Na Fila, or every item on it is sold as-is
    (_item_needs_prep is False for all of them). Otherwise - at least one
    prepared item, past Na Fila - the owner can't know from here whether
    real ingredients were already used, so it's parked in the Cancelados
    column (custom_kitchen_status="Cancelado", still docstatus=0) for a
    manual decision via resolve_cancelled_order()."""
    branch = getBranch()
    doc = frappe.get_doc("POS Invoice", invoice)

    if doc.branch != branch:
        frappe.throw(_("Not permitted to update orders outside your branch"), frappe.PermissionError)
    if doc.docstatus != 0:
        frappe.throw(_("This order was already completed"), frappe.ValidationError)

    current_status = doc.custom_kitchen_status or _COMMON_STATES[0]
    needs_decision = current_status != _COMMON_STATES[0] and any(
        _item_needs_prep(row.item_code) for row in doc.items
    )

    doc.custom_kitchen_status = "Cancelado"

    if needs_decision:
        doc.save()
        return {"invoice": doc.name, "status": "pending_decision"}

    _finalize_cancelled_order(doc, restock=True)
    return {"invoice": doc.name, "status": "cancelled"}


@frappe.whitelist(methods=["POST"])
def resolve_cancelled_order(invoice, restock):
    """Resolves a Pedido sitting in Cancelados awaiting the devolver-ao-
    estoque decision (see cancel_kitchen_order)."""
    branch = getBranch()
    doc = frappe.get_doc("POS Invoice", invoice)

    if doc.branch != branch:
        frappe.throw(_("Not permitted to update orders outside your branch"), frappe.PermissionError)
    if doc.docstatus != 0 or doc.custom_kitchen_status != "Cancelado":
        frappe.throw(_("This order is not awaiting a cancellation decision"), frappe.ValidationError)

    restock = str(restock).lower() in ("1", "true", "yes")
    _finalize_cancelled_order(doc, restock=restock)
    return {"invoice": doc.name}
