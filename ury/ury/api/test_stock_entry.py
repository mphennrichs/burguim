# Copyright (c) 2026, Tridz Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt
#
# Coverage for "Meu Estoque"'s compra (record_purchase), produção
# (record_production), vencimento (update_batch_expiry) and
# cancel_entry - zero automated coverage before this session's test
# pass. Real DB (FrappeTestCase), real Stock Entries/Batches, no mocks.

import frappe
from frappe.tests.utils import FrappeTestCase

from ury.ury.api.stock_test_utils import cancel_stock_entries_for
from frappe.utils import add_days, flt, getdate, nowdate

from ury.ury.api.bom import create_item, create_bom
from ury.ury.api.stock_entry import (
    record_purchase,
    record_production,
    update_batch_expiry,
    cancel_entry,
    get_batch_source_entry,
    _resolve_warehouse,
)

TEST_BRANCH = "_Test StockEntry API Branch"
TEST_MANAGER_EMAIL = "test_stockentry_api_manager@example.com"
TEST_POS_PROFILE = "_Test StockEntry API POS Profile"
TEST_INGREDIENT = "_Test StockEntry API Pao"
TEST_PRODUCED = "_Test StockEntry API Molho"


class TestStockEntryApi(FrappeTestCase):
    def setUp(self):
        frappe.set_user("Administrator")
        self._cleanup()
        self.company = self._resolve_or_make_company()
        self.manager = self._make_manager_user()
        self.branch = self._make_branch()
        self.pos_profile = self._make_pos_profile()

    def tearDown(self):
        frappe.set_user("Administrator")
        self._cleanup()

    # -- fixtures -------------------------------------------------------

    def _resolve_or_make_company(self):
        existing = frappe.get_all("Company", limit=1, pluck="name")
        if existing:
            return existing[0]
        comp = frappe.get_doc({"doctype": "Company", "company_name": "_Test SE Co", "default_currency": "INR"})
        comp.insert(ignore_permissions=True)
        return comp.name

    def _make_manager_user(self):
        if frappe.db.exists("User", TEST_MANAGER_EMAIL):
            user = frappe.get_doc("User", TEST_MANAGER_EMAIL)
        else:
            user = frappe.get_doc({
                "doctype": "User", "email": TEST_MANAGER_EMAIL, "first_name": "Test StockEntry Manager",
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
            "selling_price_list": "Standard Selling",
            "branch": self.branch.name,
        })
        pos_profile.append("payments", {"mode_of_payment": "Cash", "default": 1})
        pos_profile.insert(ignore_permissions=True)
        return pos_profile

    def _make_ingredient(self, shelf_life_in_days=None):
        frappe.set_user(self.manager.name)
        create_item(TEST_INGREDIENT, vendavel=0, rastreio_lote=1, stock_uom="Nos", shelf_life_in_days=shelf_life_in_days)

    def _stock_qty(self, item_code):
        warehouse = _resolve_warehouse(item_code, TEST_BRANCH)
        return flt(frappe.db.get_value("Bin", {"item_code": item_code, "warehouse": warehouse}, "actual_qty") or 0)

    def _cleanup(self):
        frappe.set_user("Administrator")
        cancel_stock_entries_for([TEST_INGREDIENT, TEST_PRODUCED])
        for name in frappe.get_all("BOM", filters={"item": TEST_PRODUCED}, pluck="name"):
            doc = frappe.get_doc("BOM", name)
            if doc.docstatus == 1:
                doc.cancel()
            frappe.delete_doc("BOM", name, ignore_permissions=True, force=1)
        for item_code in (TEST_PRODUCED, TEST_INGREDIENT):
            if frappe.db.exists("Item", item_code):
                frappe.delete_doc("Item", item_code, ignore_permissions=True, force=1)
        if frappe.db.exists("POS Profile", TEST_POS_PROFILE):
            frappe.delete_doc("POS Profile", TEST_POS_PROFILE, ignore_permissions=True, force=1)
        if frappe.db.exists("Branch", TEST_BRANCH):
            frappe.delete_doc("Branch", TEST_BRANCH, ignore_permissions=True, force=1)
        frappe.db.commit()

    # -- compra (record_purchase) -----------------------------------------

    def test_record_purchase_creates_batch_and_real_stock(self):
        self._make_ingredient()
        frappe.set_user(self.manager.name)
        before = self._stock_qty(TEST_INGREDIENT)

        result = record_purchase(TEST_INGREDIENT, qty=10, rate=2.5)

        self.assertTrue(frappe.db.exists("Batch", result["batch_no"]))
        self.assertEqual(self._stock_qty(TEST_INGREDIENT) - before, 10)
        self.assertTrue(frappe.db.exists("Stock Entry", result["stock_entry"]))

    def test_record_purchase_computes_expiry_from_shelf_life(self):
        self._make_ingredient(shelf_life_in_days=7)
        frappe.set_user(self.manager.name)
        purchase_date = getdate(nowdate())

        result = record_purchase(TEST_INGREDIENT, qty=5, rate=1)

        self.assertEqual(result["expiry_date"], add_days(purchase_date, 7))

    def test_record_purchase_rejects_non_batch_item(self):
        frappe.set_user(self.manager.name)
        create_item(TEST_PRODUCED, vendavel=1, rastreio_lote=0)

        with self.assertRaises(frappe.ValidationError):
            record_purchase(TEST_PRODUCED, qty=1, rate=1)

    def test_record_purchase_rejects_expiry_before_purchase_date(self):
        self._make_ingredient()
        frappe.set_user(self.manager.name)

        with self.assertRaises(frappe.ValidationError):
            record_purchase(TEST_INGREDIENT, qty=5, rate=1, expiry_date=add_days(nowdate(), -1))

    def test_record_purchase_rejects_zero_qty(self):
        self._make_ingredient()
        frappe.set_user(self.manager.name)

        with self.assertRaises(frappe.ValidationError):
            record_purchase(TEST_INGREDIENT, qty=0, rate=1)

    def test_record_purchase_updates_buying_item_price(self):
        self._make_ingredient()
        frappe.set_user(self.manager.name)

        record_purchase(TEST_INGREDIENT, qty=5, rate=3)
        record_purchase(TEST_INGREDIENT, qty=5, rate=4)

        from ury.ury.api.stock_entry import _default_buying_price_list

        buying_price_list = _default_buying_price_list()
        rate = frappe.db.get_value(
            "Item Price", {"item_code": TEST_INGREDIENT, "price_list": buying_price_list}, "price_list_rate",
        )
        self.assertEqual(flt(rate), 4, "Second purchase's rate must overwrite, not duplicate, the Item Price row.")

    # -- produção (record_production) -----------------------------------

    def test_record_production_consumes_ingredient_and_produces_output(self):
        self._make_ingredient()
        frappe.set_user(self.manager.name)
        create_item(TEST_PRODUCED, vendavel=0, rastreio_lote=1, stock_uom="Nos")
        create_bom(TEST_PRODUCED, quantity=1, ingredients=[{"item_code": TEST_INGREDIENT, "qty": 2}])
        record_purchase(TEST_INGREDIENT, qty=10, rate=1)
        ingredient_before = self._stock_qty(TEST_INGREDIENT)
        produced_before = self._stock_qty(TEST_PRODUCED)

        result = record_production(TEST_PRODUCED, qty=3)

        self.assertEqual(ingredient_before - self._stock_qty(TEST_INGREDIENT), 6, "3 output x 2 ingredient each.")
        self.assertEqual(self._stock_qty(TEST_PRODUCED) - produced_before, 3)
        self.assertTrue(frappe.db.exists("Batch", result["batch_no"]))

    def test_record_production_rejects_item_without_bom(self):
        self._make_ingredient()
        frappe.set_user(self.manager.name)
        create_item(TEST_PRODUCED, vendavel=0, rastreio_lote=1, stock_uom="Nos")

        with self.assertRaises(frappe.ValidationError):
            record_production(TEST_PRODUCED, qty=1)

    # -- vencimento (update_batch_expiry) ---------------------------------

    def test_update_batch_expiry_changes_date(self):
        self._make_ingredient()
        frappe.set_user(self.manager.name)
        result = record_purchase(TEST_INGREDIENT, qty=5, rate=1)
        new_date = add_days(nowdate(), 30)

        update_batch_expiry(result["batch_no"], new_date)

        self.assertEqual(frappe.db.get_value("Batch", result["batch_no"], "expiry_date"), getdate(new_date))

    def test_update_batch_expiry_rejects_unknown_batch(self):
        frappe.set_user(self.manager.name)
        with self.assertRaises(frappe.ValidationError):
            update_batch_expiry("_Test Nonexistent Batch", nowdate())

    # -- cancel_entry -------------------------------------------------------

    def test_cancel_entry_reverses_purchase_stock(self):
        self._make_ingredient()
        frappe.set_user(self.manager.name)
        before = self._stock_qty(TEST_INGREDIENT)
        result = record_purchase(TEST_INGREDIENT, qty=10, rate=1)
        self.assertEqual(self._stock_qty(TEST_INGREDIENT) - before, 10)

        cancel_entry(result["stock_entry"])

        self.assertEqual(self._stock_qty(TEST_INGREDIENT), before)
        self.assertEqual(frappe.db.get_value("Stock Entry", result["stock_entry"], "docstatus"), 2)

    def test_cancel_entry_rejects_already_cancelled(self):
        self._make_ingredient()
        frappe.set_user(self.manager.name)
        result = record_purchase(TEST_INGREDIENT, qty=5, rate=1)
        cancel_entry(result["stock_entry"])

        with self.assertRaises(frappe.ValidationError):
            cancel_entry(result["stock_entry"])

    # -- get_batch_source_entry --------------------------------------------

    def test_get_batch_source_entry_resolves_the_originating_entry(self):
        self._make_ingredient()
        frappe.set_user(self.manager.name)
        result = record_purchase(TEST_INGREDIENT, qty=5, rate=1)

        source = get_batch_source_entry(result["batch_no"])

        self.assertEqual(source["stock_entry"], result["stock_entry"])
