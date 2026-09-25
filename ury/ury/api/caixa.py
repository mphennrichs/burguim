# Copyright (c) 2026, Tridz Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt
#
# Backend for the Caixa screen (CONTEXT.md): registers a manual Pedido
# (phone/counter order) and lists past sales history. Built for a staff
# session (Dono or Caixa) - unlike self_ordering.py's guest-facing flow, no
# _elevated()/ignore_permissions is needed here, since URY Cashier already
# has create/write/submit on POS Invoice and create/write on Customer (see
# ury/patches/v2_0/default_permissions.py).
#
# A manual order is created as a DRAFT (docstatus=0), same contract the
# Tela de Cozinha (kitchen.py) already expects - it only submits the
# invoice once the order reaches its flow's terminal state
# (Retirado/Entregue), via advance_kitchen_status(). Payment is NOT
# collected here: CONTEXT.md's "Pagamento" entry is explicit that it
# happens at Retirada/Entrega, not at order time - so this mirrors
# self_ordering.py's add_customer_items(), which appends a single dummy
# payment row (the POS Profile's default Mode of Payment) sized to the
# invoice total, purely so ERPNext's own totals controller doesn't choke on
# an empty payments list before the real handoff/submit happens later.

import json

import frappe
from frappe import _
from frappe.utils import add_days, cint, getdate, nowdate

from ury.ury_pos.api import getBranch, resolve_restaurant_menu
from ury.ury.doctype.ury_order.ury_order import (
    _resolve_or_create_pos_invoice,
    price_items_for_invoice,
)

_ORDER_TYPES = ("Take Away", "Delivery")


@frappe.whitelist()
def get_sellable_items(order_type=None):
    """Sellable menu items for the Caixa's item picker, already resolved
    for the given Modalidade (order_type_wise_menu, when configured) -
    reuses the same resolver self_ordering.py's customer-facing menu does,
    rather than re-querying URY Menu directly."""
    branch = getBranch()
    menu = resolve_restaurant_menu(branch=branch, room=None, order_type=order_type, cashier=True)
    return {"items": menu["items"]}


def _resolve_customer(phone, name):
    """Find the Customer previously registered for this phone number, or
    create one - same `mobile_number` lookup convention used everywhere
    else in this codebase (self_ordering.py's _find_or_create_delivery_
    customer, ury_pos.api.create_customer). Doesn't persist a delivery
    address on the Customer itself (unlike self_ordering.py) - this
    order's address, if any, lives only on the invoice's shipping_address.
    """
    if not phone:
        frappe.throw(_("Telefone do Cliente é obrigatório"))

    existing = frappe.db.get_value("Customer", {"mobile_number": phone}, "name")
    if existing:
        if name:
            frappe.db.set_value("Customer", existing, "customer_name", name)
        return existing

    customer_group = frappe.db.get_value("Customer Group", {"is_group": 0}, "name")
    territory = frappe.db.get_value("Territory", {"is_group": 0}, "name")
    customer = frappe.get_doc({
        "doctype": "Customer",
        "customer_name": name or phone,
        "mobile_number": phone,
        "customer_group": customer_group,
        "territory": territory,
        "customer_type": "Individual",
    })
    customer.insert()
    return customer.name


@frappe.whitelist(methods=["POST"])
def create_manual_order(items, order_type, customer_phone, customer_name=None, delivery_address=None, notes=None):
    branch = getBranch()
    pos_profile = frappe.db.exists("POS Profile", {"branch": branch})
    if not pos_profile:
        frappe.throw(_("Nenhum Perfil de PDV configurado para esta filial"))

    if order_type not in _ORDER_TYPES:
        frappe.throw(_("Modalidade inválida"))
    if order_type == "Delivery" and not delivery_address:
        frappe.throw(_("Endereço de entrega é obrigatório"))

    customer = _resolve_customer(customer_phone, customer_name)

    if isinstance(items, str):
        items = json.loads(items)
    if not items:
        frappe.throw(_("Nenhum item no pedido"))

    invoice, _name = _resolve_or_create_pos_invoice(
        table=None, invoiceNo=None, order_type=order_type, is_payment=None,
    )
    # The no-table path only derives order_type from a table's is_take_away
    # flag (which doesn't apply here) - every other branch leaves it
    # untouched, same gap _bootstrap_invoice() documents/fixes for
    # self-order's pickup/delivery path.
    invoice.order_type = order_type
    # Same no-table path also never sets `invoice.branch` at all (confirmed
    # reading _resolve_or_create_pos_invoice directly - only the table
    # branch does, from the table's own branch) - required below to
    # resolve this branch's URY Menu, so set it explicitly rather than
    # relying on it.
    invoice.branch = branch
    invoice.customer = customer
    invoice.pos_profile = pos_profile
    invoice.cashier = frappe.session.user
    invoice.waiter = frappe.session.user
    if order_type == "Delivery":
        invoice.shipping_address = delivery_address
        # Not `mobile_number` - that's fetch_from: customer.mobile_number,
        # so Frappe silently overwrites any manual assignment back to the
        # linked Customer's own number on save. `contact_mobile` is the
        # plain core field, actually persists.
        invoice.contact_mobile = customer_phone
    if notes:
        invoice.custom_comments = notes[:500]

    menu = frappe.db.get_value("URY Menu", {"branch": invoice.branch}, "name")
    priced_items = price_items_for_invoice(items, invoice.selling_price_list, pos_profile, invoice.branch, menu)
    for item_dict in priced_items:
        invoice.append("items", item_dict)

    # .append() alone never recalculates totals - only save()'s own
    # validate() does, which runs AFTER this. Reading grand_total below
    # without forcing a recalc first would size the payment row off a
    # stale (zero) total. Same gotcha self_ordering.py's add_customer_items
    # hit and documents (confirmed live there: submit failing on a
    # payments-total mismatch).
    invoice.calculate_taxes_and_totals()

    posprofile_doc = frappe.get_doc("POS Profile", pos_profile)
    default_mode = posprofile_doc.payments[0].mode_of_payment if posprofile_doc.payments else None
    if not default_mode:
        frappe.throw(_("Perfil de PDV não tem forma de pagamento configurada"))
    invoice.append("payments", dict(mode_of_payment=default_mode, amount=invoice.grand_total))
    invoice.invoice_created = 1

    invoice.save()

    return {"invoice": invoice.name, "grand_total": invoice.grand_total}


@frappe.whitelist()
def get_sales_history(days=30):
    """Submitted Pedidos (docstatus=1 - completed the Tela de Cozinha's
    flow to Retirado/Entregue) for the last `days` days, most recent
    first. Doesn't reuse dashboard.py's get_recent_transactions - that's
    an unfinished stub with no real branch filter and no docstatus
    filter (would mix in still-in-progress drafts)."""
    branch = getBranch()
    days = cint(days) or 30
    start_date = add_days(getdate(nowdate()), -days)

    orders = frappe.get_all(
        "POS Invoice",
        filters={
            "branch": branch,
            "docstatus": 1,
            "posting_date": [">=", start_date],
        },
        fields=["name", "customer_name", "posting_date", "posting_time", "order_type", "grand_total"],
        order_by="posting_date desc, posting_time desc",
        limit=500,
    )
    total = sum(o.grand_total or 0 for o in orders)
    return {"orders": orders, "total": total, "count": len(orders)}
