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

from ury.ury_pos.api import getBranch, ensure_pos_opening_entry

# Estados do Pedido (CONTEXT.md) - shared "Na Fila"/"Preparando" prefix,
# then the flow diverges by Modalidade. Order in each list matters:
# advance_kitchen_status() only allows moving to the very next entry.
_COMMON_STATES = ["Na Fila", "Preparando"]
_FLOWS = {
    "Take Away": _COMMON_STATES + ["Pronto para Retirada", "Retirado"],
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
    which is exactly what made it Entrega-only).

    A Pedido stays docstatus=0 for its whole trip through the queue;
    reaching the terminal state of its flow (Retirado/Entregue) submits
    it in advance_kitchen_status(), same as the old queue's "mark
    complete" - so "not yet finished" is just docstatus=0.
    """
    branch = getBranch()
    currency_symbol = _resolve_branch_currency_symbol(branch)

    invoices = frappe.get_all(
        "POS Invoice",
        filters={
            "docstatus": 0,
            "branch": branch,
            "order_type": ["in", list(_FLOWS.keys())],
        },
        fields=[
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
        ],
        order_by="creation asc",
    )

    orders = []
    for inv in invoices:
        items = frappe.get_all(
            "POS Invoice Item",
            filters={"parent": inv.name},
            fields=["item_name", "qty", "amount"],
            order_by="idx asc",
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
        # Self-heal for a draft saved before ury_order.py's
        # _resolve_or_create_pos_invoice() stopped defaulting new
        # Retirada/Entrega invoices to update_stock=1 - without this, a
        # Pedido created before that fix deployed still submits with the
        # old value baked in and hits the same "Item has no stock" wall
        # this was meant to fix, since draft rows don't retroactively pick
        # up a code change. No made-to-order Produto in this business
        # tracks its own stock (CONTEXT.md) - see that fix's own comment
        # in ury_order.py for the full reasoning.
        doc.update_stock = 0
        doc.submit()
    else:
        doc.save()

    return {"invoice": doc.name, "kitchen_status": new_status, "completed": new_status in _TERMINAL_STATES}
