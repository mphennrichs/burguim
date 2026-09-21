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
from frappe.model.delete_doc import get_linked_docs
from frappe.utils import flt

from ury.ury_pos.api import getBranch
from ury.ury.api.branding import _resolve_company


@frappe.whitelist()
def get_bom_candidates():
    """Everything usable as a BOM's ingredient: batch-tracked items (real
    stock/expiry - see get_purchasable_items/get_production_items) AND any
    item that already has its own default BOM - recipes nest, e.g. a
    "Hambúrguer (pad)" sub-recipe can be one ingredient inside another
    recipe's own list (see ury.ury.api.stock_deduction, which unwinds this
    same nesting recursively at sale time)."""
    getBranch()
    items = {
        item.name: item
        for item in frappe.get_all(
            "Item",
            filters={"has_batch_no": 1, "disabled": 0},
            fields=["name", "item_name", "stock_uom"],
        )
    }
    composed_items = set(
        frappe.get_all("BOM", filters={"docstatus": 1, "is_active": 1, "is_default": 1}, pluck="item")
    ) - set(items)
    if composed_items:
        for item in frappe.get_all(
            "Item",
            filters={"name": ["in", list(composed_items)], "disabled": 0},
            fields=["name", "item_name", "stock_uom"],
        ):
            items[item.name] = item
    return {"items": sorted(items.values(), key=lambda i: i.item_name)}


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


# ERPNext's global UOM catalog has 150+ entries (Megahertz, Nautical Mile,
# ...) - useless noise for a kitchen. This is the handful an ingredient or
# a prepared dish actually gets measured in; frontend labels each in
# Portuguese for display, the underlying UOM name stays whatever ERPNext
# seeded it as (never renamed - other records already reference it).
_KITCHEN_UOMS = ["Nos", "Kg", "Gram", "Litre", "Millilitre"]


@frappe.whitelist()
def get_uoms():
    getBranch()
    existing = set(frappe.get_all("UOM", filters={"name": ["in", _KITCHEN_UOMS]}, pluck="name"))
    return {"uoms": [u for u in _KITCHEN_UOMS if u in existing]}


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


# Ingredients are always weighed by the gram in this kitchen (confirmed
# live: every real ingredient created so far - patinho moído, peito
# bovino - uses it) - so unlike a composed/output item, staff never has
# to think about a unit when logging one. Doesn't affect existing items;
# only the default for a brand new one.
_DEFAULT_INGREDIENT_UOM = "Gram"


@frappe.whitelist(methods=["POST"])
def create_item(item_name, kind, stock_uom=None, item_group=None, shelf_life_in_days=None, description=None):
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
    if kind == "composed" and not stock_uom:
        frappe.throw(_("Selecione uma unidade de medida"))

    item = frappe.get_doc({
        "doctype": "Item",
        "item_code": item_name,
        "item_name": item_name,
        "item_group": item_group,
        "stock_uom": stock_uom or _DEFAULT_INGREDIENT_UOM,
        "is_stock_item": 1,
        "has_batch_no": has_batch_no,
        "shelf_life_in_days": frappe.utils.cint(shelf_life_in_days) or None,
        "description": description or None,
    })
    item.insert(ignore_permissions=True)
    frappe.db.commit()

    return {
        "item": item.name,
        "stock_uom": item.stock_uom,
        "shelf_life_in_days": item.shelf_life_in_days,
        "description": item.description,
    }


@frappe.whitelist(methods=["POST"])
def rename_item(item_code, item_name):
    """Changes an item's display name - "editar o nome de uma receita"
    means this: a BOM has no name of its own, "Receitas cadastradas"
    shows the *output item's* item_name (get_boms' own item_name field
    comes straight from BOM, which Frappe only fetches from Item on the
    BOM's own next save - editing Item.item_name alone would leave the
    recipe list showing the old name until something unrelated happened
    to re-save that BOM). item_code (the Item's name/primary key,
    autoname="field:item_code") never changes here - only the label.

    Item.item_name is plain Data, not a Link, so unlike rename_course's
    rename_doc (which repoints every Link automatically) each place that
    cached a copy of the old name has to be pushed the new one by hand:
    the item's own BOM (if it's a recipe's output), every BOM Item row
    that lists it as an ingredient (nested recipes - see
    get_bom_candidates), and every URY Menu Item row that lists it on a
    cardápio. Historical Sales/POS Invoice Item rows are untouched on
    purpose, same reasoning as rename_course - a past order keeps the
    name that was true when it was placed."""
    getBranch()
    item_name = (item_name or "").strip()
    if not item_name:
        frappe.throw(_("Informe um nome"))

    frappe.db.set_value("Item", item_code, "item_name", item_name)
    frappe.db.set_value("BOM", {"item": item_code, "docstatus": 1}, "item_name", item_name)
    frappe.db.set_value("BOM Item", {"item_code": item_code}, "item_name", item_name)
    frappe.db.set_value("URY Menu Item", {"item": item_code}, "item_name", item_name)
    frappe.db.commit()
    return {"item": item_code, "item_name": item_name}


@frappe.whitelist()
def get_ingredients():
    """Raw-material items for the "Ingredientes" management tab - fuller
    detail (shelf life, description) than get_bom_candidates' minimal
    shape (name/item_name/stock_uom), which stays as-is since other code
    reads that exact shape for the recipe picker."""
    getBranch()
    return {
        "items": frappe.get_all(
            "Item",
            filters={"has_batch_no": 1, "disabled": 0},
            fields=["name", "item_name", "stock_uom", "item_group", "shelf_life_in_days", "description"],
            order_by="item_name asc",
        )
    }


@frappe.whitelist(methods=["POST"])
def update_ingredient(item_code, shelf_life_in_days=None, description=None):
    """Edits an ingredient's default shelf life and description - the
    fields "Ingredientes" lets staff change after creation. stock_uom/
    item_group stay fixed once set: changing a unit on an item that
    already has purchases/batches against it would make those historical
    quantities mean something different."""
    getBranch()
    item = frappe.get_doc("Item", item_code)
    if not item.has_batch_no:
        frappe.throw(_("Item não é um ingrediente"))
    item.shelf_life_in_days = frappe.utils.cint(shelf_life_in_days) or None
    item.description = description or None
    item.save(ignore_permissions=True)
    frappe.db.commit()
    return {"item": item.name, "shelf_life_in_days": item.shelf_life_in_days, "description": item.description}


# Repost Item Valuation rows (based_on="Item and Warehouse") link to an
# item via a real Link field, so delete_doc's generic link check treats
# them the same as a Purchase Receipt or BOM - but they're just the stock
# module's own background reconciliation jobs, not a use of the item, and
# outlive whatever transaction queued them. Left alone they silently
# block every delete with a message that (wrongly) tells the owner the
# item was used in compras/produção/receitas. Queued/In Progress ones are
# excluded - clearing those out from under an active repost could corrupt
# the valuation it's mid-computing for this item's warehouse.
_INERT_REPOST_STATUSES = ["Completed", "Skipped", "Cancelled", "Failed"]

# Friendly Portuguese label for the doctypes an Item most plausibly links
# to, keyed by exactly what get_linked_docs reports (reference_doctype) -
# anything not listed here falls back to the raw doctype name, so a link
# from a doctype nobody anticipated still names itself instead of going
# through a generic "something, somewhere" message.
_ITEM_LINK_LABELS = {
    "BOM": "uma receita (como item produzido)",
    "BOM Item": "uma receita (como ingrediente)",
    "URY Menu Item": "um cardápio",
    "Purchase Receipt": "uma compra recebida",
    "Purchase Receipt Item": "uma compra recebida",
    "Purchase Order": "um pedido de compra",
    "Purchase Order Item": "um pedido de compra",
    "Purchase Invoice": "uma nota de compra",
    "Purchase Invoice Item": "uma nota de compra",
    "Sales Invoice": "uma venda",
    "Sales Invoice Item": "uma venda",
    "POS Invoice": "uma venda",
    "POS Invoice Item": "uma venda",
    "Delivery Note": "uma entrega",
    "Delivery Note Item": "uma entrega",
    "Stock Entry": "uma movimentação de estoque",
    "Stock Entry Detail": "uma movimentação de estoque",
    "Batch": "um lote",
    "Item Price": "uma tabela de preços",
}


def _delete_item(item):
    """Shared by delete_ingredient and delete_composed_item: clear out any
    finished Repost Item Valuation jobs blocking the link check (see
    _INERT_REPOST_STATUSES above), then delete the Item itself.

    Checks get_linked_docs() (the same lookup frappe.delete_doc's own
    check_if_doc_is_linked runs internally) *before* attempting the
    delete, instead of catching the resulting LinkExistsError and
    replacing it with one message that lists every possible cause - so
    the owner is told exactly what's blocking this specific item
    ("ainda está em uma receita"), not a guess-all list."""
    pending_reposts = frappe.get_all(
        "Repost Item Valuation",
        filters={"item_code": item.name, "status": ["in", ["Queued", "In Progress"]]},
    )
    if pending_reposts:
        frappe.throw(
            _("{0} tem um reprocessamento de estoque em andamento. Tente excluir novamente em alguns minutos.").format(
                item.item_name
            )
        )

    for name in frappe.get_all(
        "Repost Item Valuation",
        filters={"item_code": item.name, "status": ["in", _INERT_REPOST_STATUSES]},
        pluck="name",
    ):
        # Submittable doctype - the repost queue processor submits it once
        # picked up, so a finished one still sits at docstatus 1. delete_doc
        # refuses a submitted record outright (force=True doesn't override
        # that - it only relaxes the link check), so cancel first.
        repost = frappe.get_doc("Repost Item Valuation", name)
        if repost.docstatus == 1:
            repost.cancel()
        frappe.delete_doc("Repost Item Valuation", name, ignore_permissions=True, force=True)

    links = get_linked_docs(item, method="Delete")
    if links:
        labels = []
        for link in links:
            label = _ITEM_LINK_LABELS.get(link["reference_doctype"], link["reference_doctype"])
            if label not in labels:
                labels.append(label)
        frappe.throw(
            _(
                "Não é possível excluir {0}: ainda está em uso em {1}. Use \"Desativar\" pra tirá-lo das listas sem apagar esse histórico."
            ).format(item.item_name, ", ".join(labels))
        )

    try:
        frappe.delete_doc("Item", item.name, ignore_permissions=True)
    except frappe.LinkExistsError:
        # get_linked_docs above covers Frappe's own static-link check, so
        # this is a fallback for something outside it (a dynamic link,
        # or a doctype's own on_trash raising this directly) - still
        # better than the raw verbose message it would show otherwise.
        frappe.clear_messages()
        frappe.throw(_("Não é possível excluir {0}: ainda está em uso.").format(item.item_name))
    frappe.db.commit()


@frappe.whitelist(methods=["POST"])
def disable_item(item_code):
    """The alternative _delete_item points to when an item has real
    history (a completed sale, a purchase, a batch...) and Frappe won't
    let it be deleted at all - disabled=0 is exactly the filter every
    candidate list here already applies (get_ingredients,
    get_composed_items, get_bom_candidates, get_bom_output_candidates),
    so this is enough to get the item out of every picker without
    touching the transactions that reference it."""
    getBranch()
    item = frappe.get_doc("Item", item_code)
    item.disabled = 1
    item.save(ignore_permissions=True)
    frappe.db.commit()
    return {"item": item_code, "disabled": 1}


@frappe.whitelist(methods=["POST"])
def delete_ingredient(item_code):
    getBranch()
    item = frappe.get_doc("Item", item_code)
    if not item.has_batch_no:
        frappe.throw(_("Item não é um ingrediente"))
    _delete_item(item)
    return {"deleted": item_code}


@frappe.whitelist()
def get_composed_items():
    """Composed/output items ("itens compostos") for a management list,
    same idea as get_ingredients but the other kind of item: has_batch_no=0
    (no batch/expiry tracking - it's assembled or sold, not stocked raw)
    and is_stock_item=1, matching how get_bom_candidates' own nested-recipe
    lookup and create_item's "composed" kind define this category. Doesn't
    include pure is_stock_item=0 menu items (Cardápio's own create-item
    flow) - those never had inventory tracking to begin with and are
    managed from the Cardápio screen, not here."""
    getBranch()
    return {
        "items": frappe.get_all(
            "Item",
            filters={"has_batch_no": 0, "is_stock_item": 1, "disabled": 0},
            fields=["name", "item_name", "stock_uom", "item_group", "description"],
            order_by="item_name asc",
        )
    }


@frappe.whitelist(methods=["POST"])
def delete_composed_item(item_code):
    getBranch()
    item = frappe.get_doc("Item", item_code)
    if item.has_batch_no or not item.is_stock_item:
        frappe.throw(_("Item não é um item composto"))
    _delete_item(item)
    return {"deleted": item_code}


# BOM has no plain description field of its own - validate_main_item()
# overwrites bom.description with the *output item's* description on
# every save, so that field can't double as prep notes. Added lazily
# (once per site, cached after) rather than via a fixtures migration,
# since nothing else here depends on bench migrate having run.
_PREP_NOTES_FIELD = "custom_preparation_notes"


def _ensure_preparation_notes_field():
    if frappe.get_meta("BOM").has_field(_PREP_NOTES_FIELD):
        return
    from frappe.custom.doctype.custom_field.custom_field import create_custom_field

    create_custom_field("BOM", {
        "fieldname": _PREP_NOTES_FIELD,
        "label": "Modo de preparo",
        "fieldtype": "Text",
        "insert_after": "description",
    })


@frappe.whitelist()
def get_boms():
    """Existing default/active recipes, with their ingredient rows, for
    the "receitas cadastradas" list."""
    getBranch()
    _ensure_preparation_notes_field()
    boms = frappe.get_all(
        "BOM",
        filters={"docstatus": 1, "is_active": 1, "is_default": 1},
        fields=["name", "item", "item_name", "quantity", "uom", _PREP_NOTES_FIELD],
        order_by="item_name asc",
    )
    for bom in boms:
        bom["preparation_notes"] = bom.pop(_PREP_NOTES_FIELD, None)
        bom["ingredients"] = frappe.get_all(
            "BOM Item",
            filters={"parent": bom.name},
            fields=["item_code", "item_name", "qty", "uom"],
            order_by="idx asc",
        )
    return {"boms": boms}


def _build_bom_rows(item_code, ingredients):
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
    return rows


def _new_bom(item_code, quantity, rows, preparation_notes, company):
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
        _PREP_NOTES_FIELD: preparation_notes or None,
    })
    bom.insert(ignore_permissions=True)
    bom.submit()
    return bom


@frappe.whitelist(methods=["POST"])
def create_bom(item_code, quantity, ingredients, preparation_notes=None):
    branch = getBranch()
    company = _resolve_company(branch)
    _ensure_preparation_notes_field()

    quantity = flt(quantity)
    if quantity <= 0:
        frappe.throw(_("Rendimento deve ser maior que zero"))

    rows = _build_bom_rows(item_code, ingredients)
    bom = _new_bom(item_code, quantity, rows, preparation_notes, company)
    frappe.db.commit()

    return {"bom": bom.name}


@frappe.whitelist(methods=["POST"])
def update_bom(bom_name, quantity, ingredients, preparation_notes=None):
    """"Editing" a submitted BOM means replacing it: cancel the old
    version and submit a new one for the same output item, the same
    versioning pattern ERPNext's own "New Version" button on the BOM form
    uses - a submitted doc's child table can't just be edited in place."""
    branch = getBranch()
    company = _resolve_company(branch)
    _ensure_preparation_notes_field()

    quantity = flt(quantity)
    if quantity <= 0:
        frappe.throw(_("Rendimento deve ser maior que zero"))

    old = frappe.get_doc("BOM", bom_name)
    rows = _build_bom_rows(old.item, ingredients)

    new_bom = _new_bom(old.item, quantity, rows, preparation_notes, company)

    old.reload()
    if old.docstatus == 1:
        old.cancel()
    frappe.db.commit()

    return {"bom": new_bom.name}


@frappe.whitelist(methods=["POST"])
def delete_bom(bom_name):
    getBranch()
    bom = frappe.get_doc("BOM", bom_name)
    if bom.docstatus == 1:
        bom.cancel()
    try:
        frappe.delete_doc("BOM", bom_name, ignore_permissions=True)
    except frappe.LinkExistsError:
        frappe.clear_messages()
        frappe.throw(
            _("Não é possível excluir a receita de {0}: já foi usada em produção.").format(bom.item_name)
        )
    frappe.db.commit()
    return {"deleted": bom_name}
