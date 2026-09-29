# Copyright (c) 2026, Tridz Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt
#
# Manager-only User account actions the admin SPA's Usuário page needs
# beyond what frappe.client.* already covers directly for it: delete (URY
# Manager has no "delete" grant on User - see role_permissions.py,
# deliberately, to avoid an accidental bulk-delete through the generic
# doctype API) and password reset (new_password lives at permlevel 1 on
# User, read-only to URY Manager under standard field-level permissions).

import frappe
from frappe import _

_MANAGER_ROLES = {"URY Manager", "URY Admin", "System Manager"}


def _require_manager():
    if frappe.session.user != "Administrator" and not _MANAGER_ROLES.intersection(frappe.get_roles()):
        frappe.throw(_("Not permitted"), frappe.PermissionError)


@frappe.whitelist(methods=["POST"])
def delete_user(user):
    _require_manager()
    if user == "Administrator":
        frappe.throw(_("Não é possível excluir a conta Administrator"))
    if user == frappe.session.user:
        frappe.throw(_("Não é possível excluir sua própria conta"))
    try:
        frappe.delete_doc("User", user, ignore_permissions=True)
    except frappe.LinkExistsError:
        # Nothing was deleted - this fails synchronously and completely, in
        # the same request (there's no partial/delayed "propagation" state
        # in Frappe's delete_doc: it's either fully undone here, or it fully
        # succeeded and the row is already gone). The user's `name` IS their
        # e-mail, so as long as this record exists (enabled or not) that
        # e-mail can never be reused by a new account - editing/re-enabling
        # THIS record is the only way to "recreate" this person.
        frappe.throw(
            _(
                "Não foi possível excluir: este usuário já aparece em outro registro "
                "(ex: um Pedido como Caixa/Atendente), então a exclusão foi bloqueada por completo - "
                "nada foi apagado. O e-mail dele continua reservado. Em vez de excluir, edite este "
                "mesmo usuário (ou desative-o) para reaproveitá-lo."
            )
        )


@frappe.whitelist(methods=["POST"])
def set_user_password(user, new_password):
    _require_manager()
    if not new_password:
        frappe.throw(_("Informe uma senha"))
    doc = frappe.get_doc("User", user)
    doc.new_password = new_password
    doc.save(ignore_permissions=True)
