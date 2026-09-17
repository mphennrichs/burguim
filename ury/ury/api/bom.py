# Copyright (c) 2026, Tridz Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt
#
# In-app BOM (recipe) creation for "Meu Estoque" - before this, a BOM
# could only be created through raw Frappe Desk (/app/bom/new), which is
# how get_menu_cost_overview/get_production_items already expected recipes
# to exist. This gives staff a form for the same thing: pick an item
# (existing or created on the spot), list what it's made of, submit a BOM.

import frappe
from frappe import _
from frappe.utils import flt

from ury.ury_pos.api import getBranch
from ury.ury.api.branding import _resolve_company


@frappe.whitelist()
def get_bom_candidates():
    """Batch-tracked items - the only ones with real stock tracking in
    this system (see get_purchasable_items/get_production_items) - usable
    as a BOM's ingredients."""
    getBranch()
    items = frappe.get_all(
        "Item",
        filters={"has_batch_no": 1, "disabled": 0},
        fields=["name", "item_name", "stock_uom"],
        order_by="item_name asc",
    )
    return {"items": items}


@frappe.whitelist()
def get_bom_output_candidates():
    """Every item usable as a BOM's output - both batch-tracked ones
    (pre-produced ahead of time, e.g. Molho da Casa) and items assembled
    to order at sale time (e.g. a burger with no batch of its own, made
    from parts). Broader than get_bom_candidates: BOM's own native "Item"
    field requires is_stock_item=1, not has_batch_no.

    Also includes every active menu item regardless of is_stock_item -
    menu items created before this feature (or via the Cardápio screen,
    which doesn't set it) predate that requirement. create_bom flips the
    flag on save rather than asking the owner to fix it first."""
    branch = getBranch()
    items = {
        item.name: item
        for item in frappe.get_all(
            "Item",
            filters={"is_stock_item": 1, "disabled": 0},
            fields=["name", "item_name", "stock_uom", "has_batch_no"],
        )
    }

    restaurant = frappe.db.get_value("URY Restaurant", {"branch": branch}, "name")
    menu = frappe.db.get_value("URY Restaurant", restaurant, "active_menu") if restaurant else None
    if menu:
        menu_items = frappe.get_all(
            "URY Menu Item",
            filters={"parent": menu, "disabled": 0},
            fields=["item", "item_name"],
        )
        known_items = {mi.item for mi in menu_items} - set(items)
        if known_items:
            for item in frappe.get_all(
                "Item",
                filters={"name": ["in", list(known_items)], "disabled": 0},
                fields=["name", "item_name", "stock_uom", "has_batch_no"],
            ):
                items[item.name] = item

    return {"items": sorted(items.values(), key=lambda i: i.item_name)}


@frappe.whitelist()
def get_item_groups():
    """Leaf Item Groups - never hardcode one by name, ERPNext's own
    regional setup seeds these under localized names (confirmed live:
    this site's are "Matéria-prima"/"Produtos", not "Raw Material"/
    "Products" - the same localization trap the buying/selling price
    list defaults already hit, see stock_entry.py)."""
    getBranch()
    return {"groups": frappe.get_all("Item Group", filters={"is_group": 0}, pluck="name", order_by="name asc")}


@frappe.whitelist()
def get_uoms():
    getBranch()
    return {"uoms": frappe.get_all("UOM", pluck="name", order_by="name asc")}


def _default_item_group(has_batch_no):
    """Best-guess Item Group for a new item: whichever group the site's
    existing items of the same kind (ingredient vs. not) mostly use -
    keeps "Criar item" to one screen without asking the owner to pick a
    group by hand every time, while still never hardcoding a group name."""
    group = frappe.db.sql(
        """
        SELECT item_group, COUNT(*) AS n
        FROM `tabItem`
        WHERE has_batch_no = %(has_batch_no)s AND disabled = 0
        GROUP BY item_group
        ORDER BY n DESC
        LIMIT 1
        """,
        {"has_batch_no": 1 if has_batch_no else 0},
    )
    if group:
        return group[0][0]
    fallback = frappe.get_all("Item Group", filters={"is_group": 0}, pluck="name", order_by="name asc", limit_page_length=1)
    return fallback[0] if fallback else None


@frappe.whitelist(methods=["POST"])
def create_item(item_name, kind, stock_uom, item_group=None, shelf_life_in_days=None):
    """Creates the underlying Item for a new ingredient ("matéria-prima")
    or assembled-to-order item ("item composto"), with exactly the flags
    each needs - is_stock_item=1 always (required for the item to be
    usable as a BOM's output at all), has_batch_no=1 only for
    ingredients (so they get real batch/expiry tracking) - instead of
    staff having to know those flags exist in Frappe Desk's Item form."""
    getBranch()
    if kind not in ("ingredient", "composed"):
        frappe.throw(_("Tipo de item inválido"))

    has_batch_no = 1 if kind == "ingredient" else 0
    item_group = item_group or _default_item_group(has_batch_no)
    if not item_group:
        frappe.throw(_("Nenhum grupo de itens cadastrado no sistema"))

    item = frappe.get_doc({
        "doctype": "Item",
        "item_code": item_name,
        "item_name": item_name,
        "item_group": item_group,
        "stock_uom": stock_uom,
        "is_stock_item": 1,
        "has_batch_no": has_batch_no,
        "shelf_life_in_days": frappe.utils.cint(shelf_life_in_days) or None,
    })
    item.insert(ignore_permissions=True)
    frappe.db.commit()

    return {"item": item.name, "stock_uom": item.stock_uom}


@frappe.whitelist()
def get_boms():
    """Existing default/active recipes, with their ingredient rows, for
    the "receitas cadastradas" list."""
    getBranch()
    boms = frappe.get_all(
        "BOM",
        filters={"docstatus": 1, "is_active": 1, "is_default": 1},
        fields=["name", "item", "item_name", "quantity", "uom"],
        order_by="item_name asc",
    )
    for bom in boms:
        bom["ingredients"] = frappe.get_all(
            "BOM Item",
            filters={"parent": bom.name},
            fields=["item_code", "item_name", "qty", "uom"],
            order_by="idx asc",
        )
    return {"boms": boms}


@frappe.whitelist(methods=["POST"])
def create_bom(item_code, quantity, ingredients):
    branch = getBranch()
    company = _resolve_company(branch)

    quantity = flt(quantity)
    if quantity <= 0:
        frappe.throw(_("Rendimento deve ser maior que zero"))

    if isinstance(ingredients, str):
        ingredients = frappe.parse_json(ingredients)

    rows = []
    for row in ingredients or []:
        ing_qty = flt(row.get("qty"))
        if ing_qty <= 0:
            continue
        rows.append({"item_code": row["item_code"], "qty": ing_qty})
    if not rows:
        frappe.throw(_("Adicione pelo menos um ingrediente"))
    if any(row["item_code"] == item_code for row in rows):
        frappe.throw(_("Um item não pode ser ingrediente da própria receita"))

    # BOM's own "Item" field requires is_stock_item=1 - a menu item created
    # via Cardápio (or before this feature existed) doesn't have it set, so
    # flip it here rather than making the owner fix it in Frappe Desk first.
    if not frappe.db.get_value("Item", item_code, "is_stock_item"):
        frappe.db.set_value("Item", item_code, "is_stock_item", 1)

    currency = frappe.get_cached_value("Company", company, "default_currency")

    bom = frappe.get_doc({
        "doctype": "BOM",
        "item": item_code,
        "company": company,
        "currency": currency,
        "quantity": quantity,
        "is_active": 1,
        "is_default": 1,
        "with_operations": 0,
        "items": rows,
    })
    bom.insert(ignore_permissions=True)
    bom.submit()
    frappe.db.commit()

    return {"bom": bom.name}
