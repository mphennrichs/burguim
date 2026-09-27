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

from ury.ury_pos.api import getBranch, resolve_restaurant_menu, ensure_pos_opening_entry
from ury.ury.doctype.ury_order.ury_order import (
    _resolve_or_create_pos_invoice,
    price_items_for_invoice,
)
from ury.ury.api.stock_deduction import (
    compute_deduction_rows_and_shortfalls,
    format_shortfalls,
    _should_block_on_insufficient_stock,
)

_ORDER_TYPES = ("Take Away", "Delivery")


@frappe.whitelist()
def get_sellable_items(order_type=None):
    """Sellable menu items for the Caixa's item picker, already resolved
    for the given Modalidade (order_type_wise_menu, when configured) -
    reuses the same resolver self_ordering.py's customer-facing menu does,
    rather than re-querying URY Menu directly.

    Each item also gets `available`/`missing_ingredient`: whether there's
    real stock (stock_deduction's own FEFO/BOM-explosion check, for one
    unit) to actually sell it right now - same computation
    create_manual_order uses to block an order, surfaced here too so the
    Caixa can grey the item out and see WHY before ever adding it to the
    cart, instead of only discovering the shortage after building the
    whole order (or worse, at the Tela de Cozinha's final submit)."""
    branch = getBranch()
    menu = resolve_restaurant_menu(branch=branch, room=None, order_type=order_type, cashier=True)
    items = menu["items"]
    for item in items:
        _, shortfalls = compute_deduction_rows_and_shortfalls(
            [{"item_code": item["item"], "qty": 1}], branch
        )
        item["available"] = not shortfalls
        item["missing_ingredient"] = shortfalls[0][0] if shortfalls else None
    return {"items": items}


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
    ensure_pos_opening_entry(pos_profile)

    if order_type not in _ORDER_TYPES:
        frappe.throw(_("Modalidade inválida"))
    if order_type == "Delivery" and not delivery_address:
        frappe.throw(_("Endereço de entrega é obrigatório"))

    customer = _resolve_customer(customer_phone, customer_name)

    if isinstance(items, str):
        items = json.loads(items)
    if not items:
        frappe.throw(_("Nenhum item no pedido"))

    # Same check deduct_stock_on_sale() runs at submit time, moved to
    # before the invoice/batch even exist - catching an insufficient-
    # stock item here means the Caixa never builds an order that would
    # only fail later at the Tela de Cozinha's final submit (confirmed
    # live: that's exactly what happened before this check existed).
    if _should_block_on_insufficient_stock():
        cart_items = [{"item_code": it.get("item"), "qty": it.get("qty")} for it in items]
        _, shortfalls = compute_deduction_rows_and_shortfalls(cart_items, branch)
        if shortfalls:
            frappe.throw(format_shortfalls(shortfalls))

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


_SALES_HISTORY_FIELDS = ["name", "customer_name", "posting_date", "posting_time", "order_type", "grand_total", "custom_kitchen_status"]


def _apply_history_filters(filters, order_type, status):
    """Shared by get_sales_history/get_customer_orders. `status` is
    "completed" (excludes Cancelado) or "cancelled" (only Cancelado) -
    left unfiltered otherwise, showing both."""
    if order_type:
        filters["order_type"] = order_type
    if status == "cancelled":
        filters["custom_kitchen_status"] = "Cancelado"
    elif status == "completed":
        filters["custom_kitchen_status"] = ["!=", "Cancelado"]
    return filters


def _sum_completed(orders):
    """A Cancelado Pedido is loss (see kitchen.py's _finalize_cancelled_
    order), never revenue - excluded from every "total vendido"/"total
    gasto" figure regardless of which status filter is active."""
    return sum(o.grand_total or 0 for o in orders if o.custom_kitchen_status != "Cancelado")


@frappe.whitelist()
def get_sales_history(days=30, order_type=None, status=None):
    """Submitted Pedidos (docstatus=1 - completed the Tela de Cozinha's
    flow, whether Retirado/Entregue or Cancelado) for the last `days`
    days, most recent first. Doesn't reuse dashboard.py's
    get_recent_transactions - that's an unfinished stub with no real
    branch filter and no docstatus filter (would mix in still-in-progress
    drafts)."""
    branch = getBranch()
    days = cint(days) or 30
    start_date = add_days(getdate(nowdate()), -days)

    filters = _apply_history_filters(
        {"branch": branch, "docstatus": 1, "posting_date": [">=", start_date]}, order_type, status,
    )
    orders = frappe.get_all(
        "POS Invoice",
        filters=filters,
        fields=_SALES_HISTORY_FIELDS,
        order_by="posting_date desc, posting_time desc",
        limit=500,
    )
    return {"orders": orders, "total": _sum_completed(orders), "count": len(orders)}


@frappe.whitelist()
def get_order_detail(invoice):
    """Full detail for one Pedido - items, observações, and a timeline of
    when it moved through each Estado (CONTEXT.md). The timeline comes
    from POS Invoice's own Version history, not a purpose-built log table:
    POS Invoice has track_changes=1 (ERPNext core), so every
    advance_kitchen_status() save/submit already leaves a Version row
    behind with the old/new custom_kitchen_status and a timestamp - no
    new tracking needed. The very first Estado ("Na Fila", the field's
    default) never gets a Version of its own (Frappe doesn't diff values
    on insert), so it's synthesized from the invoice's own creation time.
    """
    branch = getBranch()
    doc = frappe.get_doc("POS Invoice", invoice)
    if doc.branch != branch:
        frappe.throw(_("Not permitted to view orders outside your branch"), frappe.PermissionError)

    items = frappe.get_all(
        "POS Invoice Item",
        filters={"parent": invoice},
        fields=["item_name", "qty", "rate", "amount"],
        order_by="idx asc",
    )

    status_history = [{"status": "Na Fila", "changed_at": doc.creation}]
    versions = frappe.get_all(
        "Version",
        filters={"ref_doctype": "POS Invoice", "docname": invoice},
        fields=["creation", "data"],
        order_by="creation asc",
    )
    for version in versions:
        try:
            changed = json.loads(version.data).get("changed") or []
        except (TypeError, ValueError):
            continue
        for row in changed:
            # Each row is [fieldname, old_value, new_value].
            if row and row[0] == "custom_kitchen_status" and row[2]:
                status_history.append({"status": row[2], "changed_at": version.creation})

    return {
        "invoice": doc.name,
        "customer": doc.customer,
        "customer_name": doc.customer_name,
        "contact_mobile": doc.contact_mobile,
        "shipping_address": doc.shipping_address,
        "notes": doc.custom_comments or None,
        "order_type": doc.order_type,
        "kitchen_status": doc.custom_kitchen_status,
        "grand_total": doc.grand_total,
        "posting_date": doc.posting_date,
        "posting_time": doc.posting_time,
        "items": items,
        "status_history": status_history,
    }


@frappe.whitelist()
def get_customer(customer):
    """One Cliente's own record, for the Cliente detail page (name/phone/
    address) - list_customers already returns this shape per row, but a
    page opened directly by URL (no row just clicked) needs its own fetch."""
    getBranch()
    doc = frappe.db.get_value(
        "Customer", customer, ["name", "customer_name", "mobile_number", "delivery_address"], as_dict=True,
    )
    if not doc:
        frappe.throw(_("Cliente {0} não encontrado").format(customer))
    return doc


@frappe.whitelist()
def list_customers(query=None):
    """Clientes cadastrados (CONTEXT.md: identificados por telefone), pra
    aba Clientes do Caixa. Busca livre por nome ou telefone quando `query`
    é informado."""
    getBranch()
    filters = {}
    or_filters = None
    if query:
        or_filters = {
            "customer_name": ["like", f"%{query}%"],
            "mobile_number": ["like", f"%{query}%"],
        }
    customers = frappe.get_all(
        "Customer",
        filters=filters,
        or_filters=or_filters,
        fields=["name", "customer_name", "mobile_number", "delivery_address"],
        order_by="customer_name asc",
        limit=200,
    )
    return {"customers": customers}


@frappe.whitelist()
def get_customer_orders(customer, order_type=None, status=None):
    """Every completed Pedido (docstatus=1, Retirado/Entregue/Cancelado)
    for one Cliente, most recent first - same shape/filters as
    get_sales_history, filtered by the Customer link instead of a date
    range, no day cap (a Cliente's full history)."""
    getBranch()
    filters = _apply_history_filters({"customer": customer, "docstatus": 1}, order_type, status)
    orders = frappe.get_all(
        "POS Invoice",
        filters=filters,
        fields=_SALES_HISTORY_FIELDS,
        order_by="posting_date desc, posting_time desc",
        limit=500,
    )
    return {"orders": orders, "total": _sum_completed(orders), "count": len(orders)}


@frappe.whitelist(methods=["POST"])
def update_customer_address(customer, delivery_address):
    getBranch()
    if not frappe.db.exists("Customer", customer):
        frappe.throw(_("Cliente {0} não encontrado").format(customer))
    frappe.db.set_value("Customer", customer, "delivery_address", delivery_address)
    return {"customer": customer, "delivery_address": delivery_address}


@frappe.whitelist()
def lookup_customer_by_phone(phone):
    """Staff-facing phone lookup for the Novo Pedido tab's autofill toggle
    - a real authenticated staff session, unlike self_ordering.py's
    lookup_delivery_customer (allow_guest=True, gated by a session token
    instead, meant for the customer-facing self-order flow only)."""
    getBranch()
    if not phone:
        return {"found": False, "customer_name": None, "delivery_address": None}
    customer = frappe.db.get_value(
        "Customer", {"mobile_number": phone}, ["customer_name", "delivery_address"], as_dict=True,
    )
    if not customer:
        return {"found": False, "customer_name": None, "delivery_address": None}
    return {"found": True, "customer_name": customer.customer_name, "delivery_address": customer.delivery_address}
