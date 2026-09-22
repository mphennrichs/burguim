# Copyright (c) 2026, Tridz Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt
#
# Staff-facing read-only overview — "Meu Estoque" in the frontend admin
# SPA. Surfaces two things an owner otherwise has to dig for in Desk or
# wait for a full Daily P&L close-out to see: cost/margin per menu item
# (reusing the same recursive BOM cost engine that powers
# URY Daily P and L, so the two can never disagree) and upcoming batch
# expiries. Nothing here writes anything — BOM/Batch/Item Price CRUD stays
# in Desk, which already does that well.

import frappe
from frappe.utils import add_days, cint, getdate, nowdate

from ury.ury_pos.api import getBranch
from ury.ury.api.kitchen import _resolve_branch_currency_symbol
from ury.ury.doctype.ury_daily_p_and_l.ury_daily_p_and_l import inner_bom_process


def _resolve_buying_price_list(branch):
    price_list = None
    if frappe.db.exists("URY Report Settings", branch):
        price_list = frappe.db.get_value("URY Report Settings", branch, "buying_price_list")
    if price_list:
        return price_list
    # Greenfield branches (no Daily P&L configured yet) still get a usable
    # cost readout against the site's real default buying price list -
    # never the hardcoded "Standard Buying": ERPNext's own regional setup
    # can create it under a localized name instead (confirmed live: this
    # site's is "Compra Padrão"), and the wrong name here doesn't error,
    # it just silently makes every item look like it has no cost.
    return frappe.db.get_single_value("Buying Settings", "buying_price_list") or "Standard Buying"


def _resolve_item_cost(item_code, buying_price_list):
    """Cost of one unit of `item_code`: walks its default BOM recursively
    (an ingredient with its own BOM, like Molho da Casa, is costed
    recursively too — see inner_bom_process) if it has one, otherwise
    falls back to its own Buying Item Price. Mirrors exactly what
    URY Daily P and L.cogs_sold() does for a single sold item, without
    needing a full daily close-out to run it.

    Returns (cost, missing) — missing lists ingredient names still short
    a buying price/BOM somewhere in the tree; cost is None only when the
    item itself has neither a BOM nor a direct buying price.
    """
    bom_name = frappe.db.get_value(
        "BOM",
        {"item": item_code, "is_active": 1, "is_default": 1, "docstatus": 1},
        "name",
    )
    if bom_name:
        bom = frappe.get_doc("BOM", bom_name)
        result = inner_bom_process(buying_price_list, bom)
        return result["bom_buying_price"], result["unset_bom_items"]

    price = frappe.db.get_value(
        "Item Price",
        {"item_code": item_code, "price_list": buying_price_list},
        "price_list_rate",
    )
    if price is None:
        return None, [item_code]
    return float(price), []


@frappe.whitelist()
def get_menu_cost_overview():
    """Cost, margin and margin % for every active (non-archived) item on
    the logged-in staff member's branch menu.
    """
    branch = getBranch()
    currency_symbol = _resolve_branch_currency_symbol(branch)
    buying_price_list = _resolve_buying_price_list(branch)

    restaurant = frappe.db.get_value("URY Restaurant", {"branch": branch}, "name")
    menu = frappe.db.get_value("URY Restaurant", restaurant, "active_menu") if restaurant else None

    items = []
    if menu:
        menu_items = frappe.get_all(
            "URY Menu Item",
            filters={"parent": menu, "disabled": 0},
            fields=["item", "item_name", "rate"],
            order_by="item_name asc",
        )
        for mi in menu_items:
            cost, missing = _resolve_item_cost(mi.item, buying_price_list)
            margin = (mi.rate - cost) if cost is not None else None
            margin_percent = (margin / mi.rate * 100) if (margin is not None and mi.rate) else None
            items.append({
                "item": mi.item,
                "item_name": mi.item_name,
                "rate": mi.rate,
                "cost": cost,
                "margin": margin,
                "margin_percent": margin_percent,
                "missing_cost_for": missing,
            })

    return {
        "items": items,
        "currency_symbol": currency_symbol,
        "buying_price_list": buying_price_list,
    }


@frappe.whitelist()
def get_expiring_batches(days=14):
    """Batches with stock on hand, soonest expiry first. Quantity is
    summed straight from Stock Ledger Entry rather than a cached field, so
    it reflects consumption/receipts as of right now.
    """
    getBranch()  # staff-only gate; batches aren't themselves branch-scoped

    batches = frappe.db.sql(
        """
        SELECT
            b.name AS batch_no,
            b.item AS item_code,
            i.item_name AS item_name,
            i.stock_uom AS uom,
            b.expiry_date AS expiry_date,
            COALESCE(SUM(sbe.qty), 0) AS qty
        FROM `tabBatch` b
        LEFT JOIN `tabItem` i ON i.name = b.item
        LEFT JOIN `tabSerial and Batch Entry` sbe ON sbe.batch_no = b.name
        LEFT JOIN `tabSerial and Batch Bundle` sbb ON sbb.name = sbe.parent
        WHERE b.expiry_date IS NOT NULL
            AND (sbb.name IS NULL OR (sbb.docstatus = 1 AND sbb.is_cancelled = 0))
        GROUP BY b.name
        HAVING qty > 0
        ORDER BY b.expiry_date ASC
        """,
        as_dict=True,
    )

    today = getdate(nowdate())
    result = []
    for row in batches:
        expiry = getdate(row.expiry_date)
        days_left = (expiry - today).days
        if days_left > cint(days):
            continue
        if days_left < 0:
            status = "expired"
        elif days_left <= 2:
            status = "critical"
        elif days_left <= 7:
            status = "warning"
        else:
            status = "ok"
        result.append({
            "batch_no": row.batch_no,
            "item_code": row.item_code,
            "item_name": row.item_name,
            "uom": row.uom,
            "expiry_date": row.expiry_date,
            "qty": row.qty,
            "days_left": days_left,
            "status": status,
        })

    return {"batches": result}


@frappe.whitelist()
def get_consolidated_stock():
    """Total stock on hand per ingredient, right now - every batch of
    the same item summed into one number, as opposed to
    get_expiring_batches' per-batch/soonest-expiry-first list. Same
    qty-from-Stock-Ledger-Entry query, grouped by item instead of listed
    by batch, and excluding anything already past its expiry_date -
    get_expiring_batches keeps those (marked "expired", since knowing
    spoiled stock is still on the shelf is useful there); here it would
    only inflate a total meant to answer "how much do I actually have
    usable right now"."""
    getBranch()  # staff-only gate; batches aren't themselves branch-scoped

    rows = frappe.db.sql(
        """
        SELECT
            b.item AS item_code,
            i.item_name AS item_name,
            i.stock_uom AS uom,
            COALESCE(SUM(sbe.qty), 0) AS qty
        FROM `tabBatch` b
        LEFT JOIN `tabItem` i ON i.name = b.item
        LEFT JOIN `tabSerial and Batch Entry` sbe ON sbe.batch_no = b.name
        LEFT JOIN `tabSerial and Batch Bundle` sbb ON sbb.name = sbe.parent
        WHERE b.expiry_date IS NOT NULL
            AND b.expiry_date >= %(today)s
            AND (sbb.name IS NULL OR (sbb.docstatus = 1 AND sbb.is_cancelled = 0))
        GROUP BY b.item
        HAVING qty > 0
        ORDER BY i.item_name ASC
        """,
        {"today": nowdate()},
        as_dict=True,
    )
    return {"items": rows}


@frappe.whitelist()
def get_items_without_bom():
    """Active menu items with neither a default BOM nor a direct buying
    price — the "you can't cost this yet" list, surfaced separately from
    get_menu_cost_overview's per-item `missing_cost_for` so a fresh branch
    can see at a glance how much setup is left.
    """
    branch = getBranch()
    buying_price_list = _resolve_buying_price_list(branch)

    restaurant = frappe.db.get_value("URY Restaurant", {"branch": branch}, "name")
    menu = frappe.db.get_value("URY Restaurant", restaurant, "active_menu") if restaurant else None

    if not menu:
        return {"items": []}

    menu_items = frappe.get_all(
        "URY Menu Item",
        filters={"parent": menu, "disabled": 0},
        fields=["item", "item_name"],
        order_by="item_name asc",
    )

    missing = []
    for mi in menu_items:
        cost, _unused = _resolve_item_cost(mi.item, buying_price_list)
        if cost is None:
            missing.append({"item": mi.item, "item_name": mi.item_name})

    return {"items": missing}
