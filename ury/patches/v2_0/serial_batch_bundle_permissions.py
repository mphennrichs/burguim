import frappe

from ury.role_permissions import apply_permissions

# ERPNext creates a Serial and Batch Bundle, as the logged-in user, whenever a
# Stock Entry with a batch_no is submitted - our own insert(ignore_permissions=True)
# on the Stock Entry doesn't cover it. Without this, any Caixa/Dono that isn't
# also System Manager got PermissionError on order stock deduction, Compra and
# Produção.
_PERMS = {"permlevel": 0, "select": 1, "read": 1, "write": 1, "create": 1, "submit": 1, "cancel": 1}


def execute():
	for role in ("URY Cashier", "URY Manager", "URY Admin"):
		if frappe.db.exists("Role", role):
			apply_permissions("Serial and Batch Bundle", role, _PERMS)
	frappe.clear_cache()
