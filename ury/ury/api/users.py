# Copyright (c) 2026, Tridz Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt
#
# Manager-only User account actions the admin SPA's Usuário page needs
# beyond what frappe.client.* already covers directly for it: delete (URY
# Manager has no "delete" grant on User - see role_permissions.py,
# deliberately, to avoid an accidental bulk-delete through the generic
# doctype API), password reset (new_password lives at permlevel 1 on
# User, read-only to URY Manager under standard field-level permissions),
# and staff creation (see create_staff_user's own docstring for why this
# can't just be a plain frappe.client.insert from the frontend).

import frappe
from frappe import _
from frappe.utils import cint

from ury.ury_pos.api import getBranch

_MANAGER_ROLES = {"URY Manager", "URY Admin", "System Manager"}


def _require_manager():
    if frappe.session.user != "Administrator" and not _MANAGER_ROLES.intersection(frappe.get_roles()):
        frappe.throw(_("Not permitted"), frappe.PermissionError)


@frappe.whitelist(methods=["POST"])
def create_staff_user(email, first_name, last_name=None, username=None, role="URY Cashier", password=None, enabled=1):
    """Creates a staff User AND links it to the acting manager's own Branch
    in one go - every operational screen (Caixa, Tela de Cozinha, Receitas,
    Estoque, ...) resolves "which branch am I in" via ury_pos.api.getBranch(),
    which reads the `URY User` child table on Branch, NOT the User doctype
    itself. The setup wizard's own user-creation step (business_setup.py's
    submit_configure_data) already does this branch link for the first
    users - this was the missing equivalent for staff added later through
    the Usuário screen. Confirmed live: a user created via a plain
    frappe.client.insert (no branch link) hit "User is not Associated with
    any Branch" on every single screen that needs a branch, including ones
    that have nothing to do with tables/rooms (Receitas/BOM, Estoque).
    """
    _require_manager()
    if frappe.db.exists("User", email):
        frappe.throw(_("Já existe um usuário com esse e-mail"))

    branch = getBranch()

    doc = frappe.get_doc({
        "doctype": "User",
        "email": email,
        "first_name": first_name,
        "last_name": last_name,
        "username": username or None,
        "user_type": "System User",
        "enabled": cint(enabled),
        # Um e-mail de convite não faz sentido se o Dono já definiu a senha
        # aqui mesmo - a conta já fica pronta pra uso.
        "send_welcome_email": 0 if password else 1,
        "roles": [{"role": role}],
    })
    doc.insert(ignore_permissions=True)

    if password:
        doc.new_password = password
        doc.save(ignore_permissions=True)

    branch_doc = frappe.get_doc("Branch", branch)
    if not any(row.user == email for row in branch_doc.user):
        branch_doc.append("user", {"user": email})
        branch_doc.save(ignore_permissions=True)

    return {"user": doc.name}


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
