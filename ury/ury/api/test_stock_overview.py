# Copyright (c) 2026, Tridz Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt
#
# Coverage for "Meu Estoque"'s read-side (get_expiring_batches,
# get_consolidated_stock) - zero automated coverage before this session's
# test pass. Real DB (FrappeTestCase), real batches via record_purchase.

import frappe
from frappe.tests.utils import FrappeTestCase

from ury.ury.api.stock_test_utils import cancel_stock_entries_for
from frappe.utils import add_days, nowdate

from ury.ury.api.bom import create_item
from ury.ury.api.stock_entry import record_purchase, update_batch_expiry
from ury.ury.api.stock_overview import get_expiring_batches, get_consolidated_stock

TEST_BRANCH = "_Test StockOverview Branch"
TEST_MANAGER_EMAIL = "test_stockoverview_manager@example.com"
TEST_POS_PROFILE = "_Test StockOverview POS Profile"
TEST_INGREDIENT = "_Test StockOverview Alface"


class TestStockOverviewApi(FrappeTestCase):
    def setUp(self):
        frappe.set_user("Administrator")
        self._cleanup()
        self.company = self._resolve_or_make_company()
        self.manager = self._make_manager_user()
        self.branch = self._make_branch()
        self.pos_profile = self._make_pos_profile()
        frappe.set_user(self.manager.name)
        create_item(TEST_INGREDIENT, vendavel=0, rastreio_lote=1, stock_uom="Nos")

    def tearDown(self):
        frappe.set_user("Administrator")
        self._cleanup()

    def _resolve_or_make_company(self):
        existing = frappe.get_all("Company", limit=1, pluck="name")
        if existing:
            return existing[0]
        comp = frappe.get_doc({"doctype": "Company", "company_name": "_Test SO Co", "default_currency": "INR"})
        comp.insert(ignore_permissions=True)
        return comp.name

    def _make_manager_user(self):
        if frappe.db.exists("User", TEST_MANAGER_EMAIL):
            user = frappe.get_doc("User", TEST_MANAGER_EMAIL)
        else:
            user = frappe.get_doc({
                "doctype": "User", "email": TEST_MANAGER_EMAIL, "first_name": "Test StockOverview Manager",
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

    def _cleanup(self):
        frappe.set_user("Administrator")
        cancel_stock_entries_for([TEST_INGREDIENT])
        if frappe.db.exists("Item", TEST_INGREDIENT):
            frappe.delete_doc("Item", TEST_INGREDIENT, ignore_permissions=True, force=1)
        if frappe.db.exists("POS Profile", TEST_POS_PROFILE):
            frappe.delete_doc("POS Profile", TEST_POS_PROFILE, ignore_permissions=True, force=1)
        if frappe.db.exists("Branch", TEST_BRANCH):
            frappe.delete_doc("Branch", TEST_BRANCH, ignore_permissions=True, force=1)
        frappe.db.commit()

    def test_get_expiring_batches_reports_purchased_batch(self):
        frappe.set_user(self.manager.name)
        result = record_purchase(TEST_INGREDIENT, qty=5, rate=1, expiry_date=add_days(nowdate(), 3))

        batches = get_expiring_batches(days=14)["batches"]
        match = next((b for b in batches if b["batch_no"] == result["batch_no"]), None)

        self.assertIsNotNone(match)
        self.assertEqual(match["item_code"], TEST_INGREDIENT)
        self.assertEqual(float(match["qty"]), 5)
        self.assertEqual(match["status"], "warning", "3 days left is 'warning' (<=2 is 'critical', <=7 'warning').")

    def test_get_expiring_batches_excludes_batches_beyond_the_window(self):
        frappe.set_user(self.manager.name)
        record_purchase(TEST_INGREDIENT, qty=5, rate=1, expiry_date=add_days(nowdate(), 60))

        batches = get_expiring_batches(days=14)["batches"]
        matches = [b for b in batches if b["item_code"] == TEST_INGREDIENT]

        self.assertEqual(matches, [], "A batch expiring in 60 days must not show up in a 14-day window.")

    def test_get_consolidated_stock_sums_across_batches(self):
        frappe.set_user(self.manager.name)
        record_purchase(TEST_INGREDIENT, qty=3, rate=1, expiry_date=add_days(nowdate(), 30))
        record_purchase(TEST_INGREDIENT, qty=4, rate=1, expiry_date=add_days(nowdate(), 45))

        items = get_consolidated_stock()["items"]
        match = next((i for i in items if i["item_code"] == TEST_INGREDIENT), None)

        self.assertIsNotNone(match)
        self.assertEqual(float(match["qty"]), 7, "Two batches of the same item must sum into one total.")

    def test_get_consolidated_stock_excludes_expired_batches(self):
        frappe.set_user(self.manager.name)
        result = record_purchase(TEST_INGREDIENT, qty=5, rate=1, expiry_date=add_days(nowdate(), 10))
        update_batch_expiry(result["batch_no"], add_days(nowdate(), -1))

        items = get_consolidated_stock()["items"]
        match = next((i for i in items if i["item_code"] == TEST_INGREDIENT), None)

        self.assertIsNone(match, "An already-expired batch must not count toward usable consolidated stock.")
