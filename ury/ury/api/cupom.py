# Copyright (c) 2026, Tridz Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt
#
# Cupom de Desconto (CONTEXT.md): a code that applies a percentual or
# fixed discount to a whole Pedido - entered by the Cliente on the
# self-ordering site (ury.ury.api.self_ordering.apply_coupon) or passed
# by the Caixa on a manual order (ury.ury.doctype.ury_order.ury_order.
# make_invoice). Both callers share validar_e_resolver_cupom() below, so
# the validity rules (window, usage cap, one-use-per-Cliente) live in one
# place. validar_e_resolver_cupom() reads via frappe.db.get_value/exists,
# deliberately bypassing doctype permissions - a guest self-ordering
# session has no Frappe user role at all, so an ordinary permission-
# checked read would always fail for that caller.

import frappe
from frappe import _
from frappe.utils import flt, getdate, nowdate


def validar_e_resolver_cupom(codigo, customer=None):
    """Validates `codigo` against every CONTEXT.md rule and returns the
    URY Cupom row as a dict on success. Raises frappe.ValidationError
    with a customer-facing message otherwise - callers never need their
    own "was it valid" branch.
    """
    if not codigo:
        frappe.throw(_("Informe um código de cupom."))

    cupom = frappe.db.get_value(
        "URY Cupom",
        codigo.strip().upper(),
        ["name", "tipo_desconto", "valor", "valido_de", "valido_ate", "limite_usos_total", "usos", "cliente"],
        as_dict=True,
    )
    if not cupom:
        frappe.throw(_("Cupom inválido."))

    today = getdate(nowdate())
    if cupom.valido_de and today < getdate(cupom.valido_de):
        frappe.throw(_("Este cupom ainda não é válido."))
    if cupom.valido_ate and today > getdate(cupom.valido_ate):
        frappe.throw(_("Este cupom expirou."))

    if cupom.limite_usos_total and cupom.usos >= cupom.limite_usos_total:
        frappe.throw(_("Este cupom já atingiu o limite de usos."))

    if cupom.cliente and cupom.cliente != customer:
        frappe.throw(_("Este cupom é válido apenas para outro Cliente."))

    if customer and _customer_already_used(cupom.name, customer):
        frappe.throw(_("Este Cliente já usou este cupom."))

    return cupom


def _customer_already_used(cupom_name, customer):
    return bool(frappe.db.exists(
        "POS Invoice",
        {"customer": customer, "custom_cupom_aplicado": cupom_name, "docstatus": 1},
    ))


def resolve_discount_percentage(cupom, base_total):
    """Collapses a Cupom's tipo_desconto (Percentual or Fixo) into the
    single percentage POS Invoice's additional_discount_percentage
    already understands - a Cupom doesn't get its own parallel discount
    pipeline, it just arrives at that same number a different way.
    """
    if cupom.tipo_desconto == "Percentual":
        return min(100, flt(cupom.valor))

    base_total = flt(base_total)
    if base_total <= 0:
        return 0
    return min(100, (flt(cupom.valor) / base_total) * 100)


def on_pos_invoice_submit(doc, method=None):
    """doc_events on_submit hook (hooks.py) - fires no matter which
    endpoint actually calls submit() on a POS Invoice carrying a Cupom
    (the Caixa's make_invoice() checkout, or the Tela de Cozinha's
    advance_kitchen_status() reaching a terminal state), so a Cupom's
    usos is counted exactly once, at the one point true for every path:
    the Pedido actually went through - never on mere validation/preview,
    so an abandoned checkout never counts against limite_usos_total.
    """
    cupom_name = doc.get("custom_cupom_aplicado")
    if not cupom_name:
        return
    current = frappe.db.get_value("URY Cupom", cupom_name, "usos") or 0
    frappe.db.set_value("URY Cupom", cupom_name, "usos", current + 1)


@frappe.whitelist()
def preview_cupom(codigo, customer=None, base_total=0):
    """Staff-facing preview for the Caixa's PaymentDialog - validates the
    code and returns the discount it would apply, without registering
    any usage (see on_pos_invoice_submit()).
    """
    cupom = validar_e_resolver_cupom(codigo, customer)
    percentage = resolve_discount_percentage(cupom, base_total)
    return {
        "codigo": cupom.name,
        "tipo_desconto": cupom.tipo_desconto,
        "discount_percentage": percentage,
        "discount_amount": flt(base_total) * percentage / 100,
    }
