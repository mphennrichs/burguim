# Copyright (c) 2026, Tridz Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt
#
# Regression coverage for the Cancelar Pedido business rules (validated
# with the owner, see CONTEXT.md / the Kitchen Screen work):
#   - a resold item (has_batch_no, no BOM, e.g. Refrigerante) ALWAYS
#     returns to stock regardless of Estado, because it was never
#     physically prepared;
#   - a needs-prep item (BOM) only auto-returns while still "Na Fila";
#     once "Preparando" or later, it needs a manual devolver/perda
#     decision in "Cancelados";
#   - that decision is per-Pedido, but a code review found the FIRST
#     version of this swallowed the resold item's "always returns"
#     guarantee inside a mixed order's "perda" choice - this is the
#     regression test for the fix.
#
# Builds real POS Invoices via caixa.create_manual_order (not a mock),
# so this also exercises the real order-creation + at-creation stock
# deduction path end to end (FrappeTestCase, real DB).

import frappe
from frappe.tests.utils import FrappeTestCase

from ury.ury.api.stock_test_utils import cancel_stock_entries_for, delete_restaurant, make_restaurant

from ury.ury.api.stock_entry import _resolve_warehouse
from frappe.utils import flt

from ury.ury.api.caixa import create_manual_order
from ury.ury.api.kitchen import cancel_kitchen_order, resolve_cancelled_order, advance_kitchen_status
from ury.ury.api.stock_entry import record_purchase

TEST_BRANCH = "_Test KitchenCancel Branch"
TEST_MANAGER_EMAIL = "test_kitchencancel_manager@example.com"
TEST_POS_PROFILE = "_Test KitchenCancel POS Profile"
TEST_RESTAURANT = "_Test KitchenCancel Restaurant"
TEST_MENU = "_Test KitchenCancel Menu"
TEST_INGREDIENT = "_Test KitchenCancel Carne"
TEST_RESOLD = "_Test KitchenCancel Refrigerante"
TEST_RECEITA = "_Test KitchenCancel Hamburguer"
TEST_PRICE_LIST = "Standard Selling"


class TestKitchenCancel(FrappeTestCase):
    def setUp(self):
        frappe.set_user("Administrator")
        self._cleanup()
        self.company = self._resolve_or_make_company()
        self.manager = self._make_manager_user()
        self.branch = self._make_branch()
        self.pos_profile = self._make_pos_profile()
        self.ingredient = self._make_item(TEST_INGREDIENT, has_batch_no=1, is_sales_item=0, is_stock_item=1)
        self.resold = self._make_item(TEST_RESOLD, has_batch_no=1, is_sales_item=1, is_stock_item=1)
        self.receita = self._make_item(TEST_RECEITA, has_batch_no=0, is_sales_item=1, is_stock_item=0)
        self.bom = self._make_bom(TEST_RECEITA, TEST_INGREDIENT, qty=1)
        self.menu = self._make_menu()
        make_restaurant(TEST_RESTAURANT, self.branch.name, self.company, self.menu.name, TEST_POS_PROFILE, "TKCANC")
        self._make_item_price(TEST_RESOLD, 10)
        self._make_item_price(TEST_RECEITA, 25)
        # Production sells from the same warehouse purchases land in.
        frappe.db.set_value(
            "POS Profile", TEST_POS_PROFILE, "warehouse", _resolve_warehouse(TEST_RESOLD, self.branch.name)
        )

    def tearDown(self):
        frappe.set_user("Administrator")
        self._cleanup()

    # -- fixtures -------------------------------------------------------

    def _resolve_or_make_company(self):
        existing = frappe.get_all("Company", limit=1, pluck="name")
        if existing:
            return existing[0]
        comp = frappe.get_doc({"doctype": "Company", "company_name": "_Test KC Co", "default_currency": "INR"})
        comp.insert(ignore_permissions=True)
        return comp.name

    def _make_manager_user(self):
        if frappe.db.exists("User", TEST_MANAGER_EMAIL):
            user = frappe.get_doc("User", TEST_MANAGER_EMAIL)
        else:
            user = frappe.get_doc({
                "doctype": "User", "email": TEST_MANAGER_EMAIL, "first_name": "Test KitchenCancel Manager",
                "send_welcome_email": 0, "enabled": 1,
            })
            user.insert(ignore_permissions=True)
        if "URY Manager" not in frappe.get_roles(user.name):
            user.add_roles("URY Manager")
        return user

    def _make_branch(self):
        if frappe.db.exists("Branch", TEST_BRANCH):
            branch = frappe.get_doc("Branch", TEST_BRANCH)
            branch.set("user", [])
            branch.append("user", {"user": self.manager.name})
            branch.save(ignore_permissions=True)
        else:
            branch = frappe.get_doc({
                "doctype": "Branch", "branch": TEST_BRANCH, "user": [{"user": self.manager.name}],
            })
            branch.insert(ignore_permissions=True)
        return branch

    def _make_pos_profile(self):
        if frappe.db.exists("POS Profile", TEST_POS_PROFILE):
            frappe.delete_doc("POS Profile", TEST_POS_PROFILE, ignore_permissions=True, force=1)
        warehouse = frappe.db.get_value("Warehouse", {"company": self.company, "is_group": 0}, "name")
        pos_profile = frappe.get_doc({
            "doctype": "POS Profile",
            "name": TEST_POS_PROFILE,
            "naming_series": "_T-POS Profile-",
            "company": self.company,
            "currency": "INR",
            "warehouse": warehouse,
            "cost_center": frappe.db.get_value("Cost Center", {"company": self.company, "is_group": 0}, "name"),
            "income_account": frappe.db.get_value(
                "Account", {"company": self.company, "account_type": "Income Account", "is_group": 0}, "name"
            ),
            "expense_account": frappe.db.get_value(
                "Account", {"company": self.company, "account_type": "Cost of Goods Sold", "is_group": 0}, "name"
            ),
            "write_off_account": frappe.db.get_value(
                "Account", {"company": self.company, "account_name": ["like", "%Write Off%"], "is_group": 0}, "name"
            ),
            "write_off_cost_center": frappe.db.get_value("Cost Center", {"company": self.company, "is_group": 0}, "name"),
            "write_off_limit": 0,
            "selling_price_list": TEST_PRICE_LIST,
            "branch": self.branch.name,
        })
        pos_profile.append("payments", {"mode_of_payment": "Cash", "default": 1})
        pos_profile.insert(ignore_permissions=True)
        return pos_profile

    def _item_group(self):
        return frappe.db.get_value("Item Group", {"is_group": 0}, "name")

    def _make_item(self, item_code, has_batch_no, is_sales_item, is_stock_item):
        if frappe.db.exists("Item", item_code):
            frappe.delete_doc("Item", item_code, ignore_permissions=True, force=1)
        item = frappe.get_doc({
            "doctype": "Item", "item_code": item_code, "item_name": item_code,
            "item_group": self._item_group(), "stock_uom": "Nos",
            "is_stock_item": is_stock_item, "has_batch_no": has_batch_no, "is_sales_item": is_sales_item,
        })
        item.insert(ignore_permissions=True)
        return item

    def _make_bom(self, item_code, ingredient_code, qty):
        bom = frappe.get_doc({
            "doctype": "BOM", "item": item_code, "quantity": 1, "is_active": 1, "is_default": 1,
            "items": [{"item_code": ingredient_code, "qty": qty, "uom": "Nos", "stock_uom": "Nos", "conversion_factor": 1}],
        })
        bom.insert(ignore_permissions=True)
        bom.submit()
        return bom

    def _make_menu(self):
        if frappe.db.exists("URY Menu", TEST_MENU):
            frappe.delete_doc("URY Menu", TEST_MENU, ignore_permissions=True, force=1)
        menu = frappe.get_doc({
            "doctype": "URY Menu",
            "name": TEST_MENU,
            "branch": self.branch.name,
            "enabled": 1,
            "items": [
                {"item": TEST_RESOLD, "item_name": TEST_RESOLD, "rate": 10},
                {"item": TEST_RECEITA, "item_name": TEST_RECEITA, "rate": 25},
            ],
        })
        menu.insert(ignore_permissions=True)
        return menu

    def _make_item_price(self, item_code, rate):
        if frappe.db.exists("Item Price", {"item_code": item_code, "price_list": TEST_PRICE_LIST}):
            return
        frappe.get_doc({
            "doctype": "Item Price", "item_code": item_code, "price_list": TEST_PRICE_LIST, "price_list_rate": rate,
        }).insert(ignore_permissions=True)

    def _purchase(self, item_code, qty, rate=1):
        frappe.set_user(self.manager.name)
        record_purchase(item_code, qty, rate)

    def _stock_qty(self, item_code):
        warehouse = _resolve_warehouse(item_code, TEST_BRANCH)
        return flt(frappe.db.get_value("Bin", {"item_code": item_code, "warehouse": warehouse}, "actual_qty") or 0)

    def _create_order(self, items):
        frappe.set_user(self.manager.name)
        result = create_manual_order(
            items=items, order_type="Take Away", customer_phone="+5511999990000", customer_name="Test Customer",
        )
        return result["invoice"]

    def _cleanup(self):
        frappe.set_user("Administrator")
        for inv in frappe.get_all("POS Invoice", filters={"branch": TEST_BRANCH}, pluck="name"):
            doc = frappe.get_doc("POS Invoice", inv)
            if doc.docstatus == 1:
                doc.cancel()
            frappe.delete_doc("POS Invoice", inv, ignore_permissions=True, force=1)
        cancel_stock_entries_for([TEST_RECEITA, TEST_RESOLD, TEST_INGREDIENT])
        for name in frappe.get_all("POS Opening Entry", filters={"pos_profile": TEST_POS_PROFILE}, pluck="name"):
            doc = frappe.get_doc("POS Opening Entry", name)
            if doc.docstatus == 1:
                doc.cancel()
            frappe.delete_doc("POS Opening Entry", name, ignore_permissions=True, force=1)
        if frappe.db.exists("URY Menu", TEST_MENU):
            frappe.delete_doc("URY Menu", TEST_MENU, ignore_permissions=True, force=1)
        frappe.db.delete("Item Price", {"item_code": ["in", [TEST_RESOLD, TEST_RECEITA]]})
        for name in frappe.get_all("BOM", filters={"item": TEST_RECEITA}, pluck="name"):
            doc = frappe.get_doc("BOM", name)
            if doc.docstatus == 1:
                doc.cancel()
            frappe.delete_doc("BOM", name, ignore_permissions=True, force=1)
        for item_code in (TEST_RECEITA, TEST_RESOLD, TEST_INGREDIENT):
            if frappe.db.exists("Item", item_code):
                frappe.delete_doc("Item", item_code, ignore_permissions=True, force=1)
        delete_restaurant(TEST_RESTAURANT)
        if frappe.db.exists("POS Profile", TEST_POS_PROFILE):
            frappe.delete_doc("POS Profile", TEST_POS_PROFILE, ignore_permissions=True, force=1)
        if frappe.db.exists("Branch", TEST_BRANCH):
            frappe.delete_doc("Branch", TEST_BRANCH, ignore_permissions=True, force=1)
        frappe.db.commit()

    # -- resold item: always returns, regardless of Estado ----------------

    def test_cancel_na_fila_resold_item_auto_resolves_and_restores_stock(self):
        self._purchase(TEST_RESOLD, qty=5)
        before = self._stock_qty(TEST_RESOLD)
        invoice = self._create_order([{"item": TEST_RESOLD, "item_name": TEST_RESOLD, "qty": 1}])
        self.assertEqual(self._stock_qty(TEST_RESOLD), before - 1)

        frappe.set_user(self.manager.name)
        result = cancel_kitchen_order(invoice)

        self.assertEqual(result["status"], "cancelled")
        self.assertEqual(frappe.db.get_value("POS Invoice", invoice, "docstatus"), 1)
        self.assertEqual(frappe.db.get_value("POS Invoice", invoice, "custom_kitchen_status"), "Cancelado")
        self.assertEqual(self._stock_qty(TEST_RESOLD), before, "Resold item must be fully restored.")

    def test_cancel_preparando_resold_only_still_auto_resolves(self):
        """No item needs prep -> auto-resolve regardless of Estado, even
        past Na Fila."""
        self._purchase(TEST_RESOLD, qty=5)
        before = self._stock_qty(TEST_RESOLD)
        invoice = self._create_order([{"item": TEST_RESOLD, "item_name": TEST_RESOLD, "qty": 1}])
        frappe.set_user(self.manager.name)
        advance_kitchen_status(invoice, "Preparando")

        result = cancel_kitchen_order(invoice)

        self.assertEqual(result["status"], "cancelled")
        self.assertEqual(self._stock_qty(TEST_RESOLD), before)

    # -- needs-prep item: Na Fila auto-resolves, Preparando+ needs a decision --

    def test_cancel_na_fila_receita_auto_resolves_and_restores_stock(self):
        self._purchase(TEST_INGREDIENT, qty=5)
        before = self._stock_qty(TEST_INGREDIENT)
        invoice = self._create_order([{"item": TEST_RECEITA, "item_name": TEST_RECEITA, "qty": 1}])
        self.assertEqual(self._stock_qty(TEST_INGREDIENT), before - 1)

        frappe.set_user(self.manager.name)
        result = cancel_kitchen_order(invoice)

        self.assertEqual(result["status"], "cancelled")
        self.assertEqual(self._stock_qty(TEST_INGREDIENT), before)

    def test_cancel_preparando_receita_needs_decision(self):
        self._purchase(TEST_INGREDIENT, qty=5)
        invoice = self._create_order([{"item": TEST_RECEITA, "item_name": TEST_RECEITA, "qty": 1}])
        frappe.set_user(self.manager.name)
        advance_kitchen_status(invoice, "Preparando")

        result = cancel_kitchen_order(invoice)

        self.assertEqual(result["status"], "pending_decision")
        self.assertEqual(frappe.db.get_value("POS Invoice", invoice, "docstatus"), 0)
        self.assertEqual(frappe.db.get_value("POS Invoice", invoice, "custom_kitchen_status"), "Cancelado")

    def test_resolve_cancelled_receita_restock_true_restores_stock(self):
        self._purchase(TEST_INGREDIENT, qty=5)
        before = self._stock_qty(TEST_INGREDIENT)
        invoice = self._create_order([{"item": TEST_RECEITA, "item_name": TEST_RECEITA, "qty": 1}])
        frappe.set_user(self.manager.name)
        advance_kitchen_status(invoice, "Preparando")
        cancel_kitchen_order(invoice)

        resolve_cancelled_order(invoice, True)

        self.assertEqual(frappe.db.get_value("POS Invoice", invoice, "docstatus"), 1)
        self.assertEqual(self._stock_qty(TEST_INGREDIENT), before)

    def test_resolve_cancelled_receita_restock_false_keeps_stock_deducted(self):
        self._purchase(TEST_INGREDIENT, qty=5)
        invoice = self._create_order([{"item": TEST_RECEITA, "item_name": TEST_RECEITA, "qty": 1}])
        frappe.set_user(self.manager.name)
        advance_kitchen_status(invoice, "Preparando")
        cancel_kitchen_order(invoice)
        after_cancel = self._stock_qty(TEST_INGREDIENT)

        resolve_cancelled_order(invoice, False)

        self.assertEqual(frappe.db.get_value("POS Invoice", invoice, "docstatus"), 1)
        self.assertEqual(
            self._stock_qty(TEST_INGREDIENT), after_cancel,
            "restock=False must leave the already-deducted ingredient as loss, not restore it.",
        )

    # -- the actual regression: mixed order, resold half always returns ----

    def test_mixed_order_restock_false_still_returns_resold_item(self):
        """The bug a code review found: Hambúrguer (needs prep) + Coca
        (resold) in the SAME Pedido, cancelled Preparando, resolved
        "Não devolver" - the Coca must STILL come back, even though the
        decision as a whole is "perda" (that only applies to the
        Hambúrguer's ingredients)."""
        self._purchase(TEST_INGREDIENT, qty=5)
        self._purchase(TEST_RESOLD, qty=5)
        ingredient_before = self._stock_qty(TEST_INGREDIENT)
        resold_before = self._stock_qty(TEST_RESOLD)

        invoice = self._create_order([
            {"item": TEST_RECEITA, "item_name": TEST_RECEITA, "qty": 1},
            {"item": TEST_RESOLD, "item_name": TEST_RESOLD, "qty": 1},
        ])
        frappe.set_user(self.manager.name)
        advance_kitchen_status(invoice, "Preparando")
        cancel_result = cancel_kitchen_order(invoice)
        self.assertEqual(cancel_result["status"], "pending_decision")

        resolve_cancelled_order(invoice, False)

        self.assertEqual(
            self._stock_qty(TEST_RESOLD), resold_before,
            "Resold item (Coca) must ALWAYS return to stock, regardless of the "
            "restock=False decision made for the rest of a mixed Pedido.",
        )
        self.assertLess(
            self._stock_qty(TEST_INGREDIENT), ingredient_before,
            "The needs-prep item's (Hambúrguer) ingredient must remain deducted as loss.",
        )
