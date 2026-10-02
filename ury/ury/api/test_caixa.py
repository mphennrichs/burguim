# Copyright (c) 2026, Tridz Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt
#
# Regression coverage for the ORIGINAL bug this whole session started
# from: "Bloquear venda sem estoque suficiente" was on, but the Caixa
# could still CREATE an order for an item with insufficient stock - it
# only failed later, at the Tela de Cozinha's final submit. Confirmed
# live (ValidationError: "Estoque insuficiente para: Carne de hamburguer").
# create_manual_order must now block at creation time; get_sellable_items
# must grey the item out (available=False) before it's even added to the
# cart. Real DB (FrappeTestCase), no mocks.

import frappe
from frappe.tests.utils import FrappeTestCase

from ury.ury.api.stock_test_utils import cancel_stock_entries_for, delete_restaurant, make_restaurant

from ury.ury.api.caixa import create_manual_order, get_sellable_items
from ury.ury.api.stock_entry import record_purchase

TEST_BRANCH = "_Test Caixa Branch"
TEST_MANAGER_EMAIL = "test_caixa_api_manager@example.com"
TEST_POS_PROFILE = "_Test Caixa POS Profile"
TEST_RESTAURANT = "_Test Caixa Restaurant"
TEST_MENU = "_Test Caixa Menu"
TEST_INGREDIENT = "_Test Caixa Carne"
TEST_RECEITA = "_Test Caixa Hamburguer"
TEST_PRICE_LIST = "Standard Selling"


class TestCaixaStockBlocking(FrappeTestCase):
    def setUp(self):
        frappe.set_user("Administrator")
        self._cleanup()
        self.company = self._resolve_or_make_company()
        self.manager = self._make_manager_user()
        self.branch = self._make_branch()
        self.pos_profile = self._make_pos_profile()
        self.ingredient = self._make_item(TEST_INGREDIENT, has_batch_no=1, is_sales_item=0, is_stock_item=1)
        self.receita = self._make_item(TEST_RECEITA, has_batch_no=0, is_sales_item=1, is_stock_item=0)
        self.bom = self._make_bom()
        self.menu = self._make_menu()
        make_restaurant(TEST_RESTAURANT, self.branch.name, self.company, self.menu.name, TEST_POS_PROFILE, "TCAIXA")
        self._make_item_price(TEST_RECEITA, 25)
        frappe.db.set_single_value("URY Stock Settings", "block_sale_on_insufficient_stock", 1)

    def tearDown(self):
        frappe.set_user("Administrator")
        self._cleanup()

    # -- fixtures (same shape as test_kitchen_cancel.py) -------------------

    def _resolve_or_make_company(self):
        existing = frappe.get_all("Company", limit=1, pluck="name")
        if existing:
            return existing[0]
        comp = frappe.get_doc({"doctype": "Company", "company_name": "_Test Caixa Co", "default_currency": "INR"})
        comp.insert(ignore_permissions=True)
        return comp.name

    def _make_manager_user(self):
        if frappe.db.exists("User", TEST_MANAGER_EMAIL):
            user = frappe.get_doc("User", TEST_MANAGER_EMAIL)
        else:
            user = frappe.get_doc({
                "doctype": "User", "email": TEST_MANAGER_EMAIL, "first_name": "Test Caixa Manager",
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

    def _make_bom(self):
        bom = frappe.get_doc({
            "doctype": "BOM", "item": TEST_RECEITA, "quantity": 1, "is_active": 1, "is_default": 1,
            "items": [{"item_code": TEST_INGREDIENT, "qty": 1, "uom": "Nos", "stock_uom": "Nos", "conversion_factor": 1}],
        })
        bom.insert(ignore_permissions=True)
        bom.submit()
        return bom

    def _make_menu(self):
        if frappe.db.exists("URY Menu", TEST_MENU):
            frappe.delete_doc("URY Menu", TEST_MENU, ignore_permissions=True, force=1)
        menu = frappe.get_doc({
            "doctype": "URY Menu", "name": TEST_MENU, "branch": self.branch.name, "enabled": 1,
            "items": [{"item": TEST_RECEITA, "item_name": TEST_RECEITA, "rate": 25}],
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

    def _cleanup(self):
        frappe.set_user("Administrator")
        for inv in frappe.get_all("POS Invoice", filters={"branch": TEST_BRANCH}, pluck="name"):
            doc = frappe.get_doc("POS Invoice", inv)
            if doc.docstatus == 1:
                doc.cancel()
            frappe.delete_doc("POS Invoice", inv, ignore_permissions=True, force=1)
        cancel_stock_entries_for([TEST_RECEITA, TEST_INGREDIENT])
        for name in frappe.get_all("POS Opening Entry", filters={"pos_profile": TEST_POS_PROFILE}, pluck="name"):
            doc = frappe.get_doc("POS Opening Entry", name)
            if doc.docstatus == 1:
                doc.cancel()
            frappe.delete_doc("POS Opening Entry", name, ignore_permissions=True, force=1)
        if frappe.db.exists("URY Menu", TEST_MENU):
            frappe.delete_doc("URY Menu", TEST_MENU, ignore_permissions=True, force=1)
        frappe.db.delete("Item Price", {"item_code": TEST_RECEITA})
        for name in frappe.get_all("BOM", filters={"item": TEST_RECEITA}, pluck="name"):
            doc = frappe.get_doc("BOM", name)
            if doc.docstatus == 1:
                doc.cancel()
            frappe.delete_doc("BOM", name, ignore_permissions=True, force=1)
        for item_code in (TEST_RECEITA, TEST_INGREDIENT):
            if frappe.db.exists("Item", item_code):
                frappe.delete_doc("Item", item_code, ignore_permissions=True, force=1)
        delete_restaurant(TEST_RESTAURANT)
        if frappe.db.exists("POS Profile", TEST_POS_PROFILE):
            frappe.delete_doc("POS Profile", TEST_POS_PROFILE, ignore_permissions=True, force=1)
        if frappe.db.exists("Branch", TEST_BRANCH):
            frappe.delete_doc("Branch", TEST_BRANCH, ignore_permissions=True, force=1)
        frappe.db.commit()

    # -- the actual regression ---------------------------------------------

    def test_create_manual_order_blocks_at_creation_when_stock_insufficient(self):
        """The original bug: this must fail HERE, at creation, not later
        at the Tela de Cozinha's final submit."""
        # Nothing bought: needs 1, 0 available.
        frappe.set_user(self.manager.name)
        frappe.db.commit()

        with self.assertRaises(frappe.ValidationError):
            create_manual_order(
                items=[{"item": TEST_RECEITA, "item_name": TEST_RECEITA, "qty": 1}],
                order_type="Take Away", customer_phone="+5511999990001", customer_name="Test Customer",
            )
        # What Frappe's request handler does on any exception - a draft left
        # behind after this means something in the path committed early.
        frappe.db.rollback()

        self.assertEqual(
            frappe.db.count("POS Invoice", {"branch": TEST_BRANCH}),
            0,
            "A rejected order must not leave a half-created draft behind.",
        )

    def test_create_manual_order_succeeds_when_stock_sufficient(self):
        self._purchase(TEST_INGREDIENT, qty=5)
        frappe.set_user(self.manager.name)

        result = create_manual_order(
            items=[{"item": TEST_RECEITA, "item_name": TEST_RECEITA, "qty": 1}],
            order_type="Take Away", customer_phone="+5511999990002", customer_name="Test Customer",
        )

        self.assertTrue(frappe.db.exists("POS Invoice", result["invoice"]))

    def test_get_sellable_items_greys_out_item_with_insufficient_stock(self):
        frappe.set_user(self.manager.name)

        items = get_sellable_items()["items"]
        receita = next(i for i in items if i["item"] == TEST_RECEITA)

        self.assertFalse(receita["available"])
        self.assertEqual(receita["missing_ingredient"], TEST_INGREDIENT)

    def test_get_sellable_items_shows_available_with_sufficient_stock(self):
        self._purchase(TEST_INGREDIENT, qty=5)
        frappe.set_user(self.manager.name)

        items = get_sellable_items()["items"]
        receita = next(i for i in items if i["item"] == TEST_RECEITA)

        self.assertTrue(receita["available"])
        self.assertIsNone(receita["missing_ingredient"])
        self.assertEqual(receita["max_qty"], 5)
