# Copyright (c) 2026, Tridz Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt
#
# Staff-facing operational queue for delivery orders — not a guest surface
# (contrast with ury.ury.api.self_ordering, which customers hit anonymously).
# Every function here relies on Frappe's normal doctype permissions for the
# logged-in staff user; nothing is elevated or guest-safe.

import frappe
from frappe import _

from ury.ury_pos.api import getBranch


def _resolve_branch_currency_symbol(branch):
    """`frontend` (the admin SPA this powers) never populates the shared
    `currencySymbol` localStorage key the way `pos` does on its own staff
    login — every currency display across the whole app silently falls
    back to formatCurrency's hardcoded '₹' default (confirmed live, same
    root cause self_ordering.py's _resolve_currency_symbol fixed for
    self-order). Fixing that app-wide is a separate, broader pass; this
    resolves it just for this page's own response so a brand-new screen
    doesn't ship with a known-wrong currency symbol.
    """
    pos_profile = frappe.db.get_value("POS Profile", {"branch": branch}, "name")
    currency = frappe.db.get_value("POS Profile", pos_profile, "currency") if pos_profile else None
    if not currency:
        return None
    return frappe.db.get_value("Currency", currency, "symbol") or currency


def _fetch_delivery_orders(branch, docstatus, order_by, limit=None):
    """Shared query + shaping for both the pending queue and the completed
    history — same DTO shape either way, just a different docstatus/order.
    """
    invoices = frappe.get_all(
        "POS Invoice",
        filters={"order_type": "Delivery", "docstatus": docstatus, "branch": branch},
        fields=[
            "name",
            "customer",
            "customer_name",
            "shipping_address",
            "contact_mobile",
            "custom_comments",
            "creation",
            "modified",
            "grand_total",
        ],
        order_by=order_by,
        limit_page_length=limit or 0,
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
            "delivery_address": inv.shipping_address,
            "delivery_phone": inv.contact_mobile,
            "notes": inv.custom_comments or None,
            "grand_total": inv.grand_total,
            "created_at": inv.creation,
            # Only meaningful in the completed history — see
            # list_delivery_order_history(). `modified` is the timestamp of
            # the submit() call itself (nothing else touches a completed
            # order afterward), so it doubles as "completed at" without a
            # dedicated field.
            "completed_at": inv.modified if docstatus == 1 else None,
            "items": items,
        })

    return orders


@frappe.whitelist()
def list_delivery_orders():
    """Pending (not yet submitted) Delivery orders for the logged-in
    staff member's branch, oldest first — the operational queue a
    delivery-only restaurant checks so nothing gets forgotten.

    Each self-order Delivery session runs its whole order through one
    running POS Invoice (self_ordering.add_customer_items always appends
    into the same invoice rather than creating a new one per call), so
    "grouped by customer" falls out for free here: one card per invoice
    is already one customer's whole order, not scattered per-item rows.
    """
    branch = getBranch()
    currency_symbol = _resolve_branch_currency_symbol(branch)
    orders = _fetch_delivery_orders(branch, docstatus=0, order_by="creation asc")
    return {"orders": orders, "currency_symbol": currency_symbol}


@frappe.whitelist()
def list_delivery_order_history(limit=50):
    """Completed (submitted) Delivery orders for the logged-in staff
    member's branch, most recently completed first.
    """
    branch = getBranch()
    currency_symbol = _resolve_branch_currency_symbol(branch)
    orders = _fetch_delivery_orders(
        branch, docstatus=1, order_by="modified desc", limit=frappe.utils.cint(limit) or 50,
    )
    return {"orders": orders, "currency_symbol": currency_symbol}


@frappe.whitelist()
def mark_delivery_order_complete(invoice):
    """Submit the invoice once it's been prepared and handed off.

    Payment was already registered against the branch's default Cash mode
    of payment when the order was first placed (add_customer_items in
    self_ordering.py appends a payment row sized to the full total at
    invoice-creation time) — matches "cobrança na hora da entrega":
    submitting here is the confirmation that payment was actually
    collected on handoff, not a separate payment step of its own.
    """
    branch = getBranch()
    doc = frappe.get_doc("POS Invoice", invoice)

    if doc.branch != branch:
        frappe.throw(_("Not permitted to update orders outside your branch"), frappe.PermissionError)
    if doc.order_type != "Delivery":
        frappe.throw(_("This is not a delivery order"), frappe.ValidationError)
    if doc.docstatus != 0:
        frappe.throw(_("This order was already completed"), frappe.ValidationError)

    doc.submit()
    return {"status": "Completed", "invoice": doc.name}
