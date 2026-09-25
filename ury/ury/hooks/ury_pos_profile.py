import frappe
from frappe import _, msgprint


def validate(doc, method):
    validate_bill_check(doc, method)
    validate_cost_center(doc, method)
    set_restaurant_from_branch(doc, method)


def set_restaurant_from_branch(doc, method):
    """`restaurant` (Link to URY Restaurant) has no UI of its own on the
    admin SPA's Perfil de PDV form (frontend/src/pages/Dashboard/
    PosProfilePage.tsx never reads or writes it) and nothing else auto-
    derived it - every profile created there was silently missing it.
    Harmless until create_pos_opening_entry() (ury_pos/api.py) started
    requiring it ("Selected POS Profile has no Restaurant."), since
    there's a 1:1 URY Restaurant-per-Branch relationship everywhere else
    in this codebase already (e.g. ury_order.py's own branch->restaurant
    lookups) - self-heal it the same way instead of surfacing this as a
    dead end the owner can't fix from the app.
    """
    if doc.restaurant or not doc.branch:
        return
    doc.restaurant = frappe.db.get_value("URY Restaurant", {"branch": doc.branch}, "name")


def validate_bill_check(doc, method):
    if getattr(doc, "printer_settings", None) and isinstance(doc.printer_settings, (list, tuple)):
        for row in doc.printer_settings:
            if hasattr(row, "bill") and hasattr(row, "printer"):
                if not getattr(row, "bill", None) or not getattr(row, "printer", None):
                    msgprint(
                        _(
                            "Either Bill is not enabled / Printer is not selected in Printer Settings."
                        )
                    )
            
def validate_cost_center(doc, method):
    if not doc.cost_center:
       frappe.throw(
                _(
                    "Cost center is mandatory."
                )
            )
