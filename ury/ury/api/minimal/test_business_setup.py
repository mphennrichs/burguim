# Copyright (c) 2026, Tridz Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe
from frappe.tests.utils import FrappeTestCase

from ury.ury.api.minimal.business_setup import _ensure_mode_of_payment_account, get_branches

TEST_BRANCH = "_Test BizSetup Branch"
TEST_MANAGER_EMAIL = "test_bizsetup_manager@example.com"
TEST_WEBSITE_USER = "test_bizsetup_website@example.com"
TEST_MOP = "_Test BizSetup Pix"


class TestBusinessSetup(FrappeTestCase):
    def setUp(self):
        frappe.set_user("Administrator")
        self._cleanup()
        self.company = frappe.get_all("Company", limit=1, pluck="name")[0]
        self.manager = self._user(TEST_MANAGER_EMAIL, role="URY Manager")
        frappe.get_doc({"doctype": "Branch", "branch": TEST_BRANCH, "user": [{"user": TEST_MANAGER_EMAIL}]}).insert(
            ignore_permissions=True
        )

    def tearDown(self):
        frappe.set_user("Administrator")
        self._cleanup()

    def _cleanup(self):
        frappe.set_user("Administrator")
        if frappe.db.exists("Branch", TEST_BRANCH):
            frappe.delete_doc("Branch", TEST_BRANCH, ignore_permissions=True, force=1)
        for name in (TEST_MANAGER_EMAIL, TEST_WEBSITE_USER):
            if frappe.db.exists("User", name):
                frappe.delete_doc("User", name, ignore_permissions=True, force=1)
        if frappe.db.exists("Mode of Payment", TEST_MOP):
            frappe.delete_doc("Mode of Payment", TEST_MOP, ignore_permissions=True, force=1)
        frappe.db.commit()

    def _user(self, email, user_type="System User", role=None):
        user = frappe.get_doc({
            "doctype": "User", "email": email, "first_name": email.split("@")[0],
            "send_welcome_email": 0, "user_type": user_type,
        }).insert(ignore_permissions=True)
        if role:
            user.add_roles(role)
        return user

    def test_get_branches_works_for_dono_after_setup(self):
        """It backs the topbar branch selector - before, every Dono got a 403
        once any Branch existed, so the selector was always empty."""
        frappe.set_user(TEST_MANAGER_EMAIL)

        names = [b["name"] for b in get_branches()]

        self.assertIn(TEST_BRANCH, names)

    def test_get_branches_rejects_non_staff(self):
        self._user(TEST_WEBSITE_USER, user_type="Website User")
        frappe.set_user(TEST_WEBSITE_USER)

        with self.assertRaises(frappe.PermissionError):
            get_branches()

    def test_payment_method_gets_company_cash_account(self):
        """A brand-new company's payment methods have no account, and the POS
        Profile the wizard creates right after refuses them."""
        frappe.get_doc({"doctype": "Mode of Payment", "mode_of_payment": TEST_MOP, "type": "General"}).insert(
            ignore_permissions=True
        )
        expected = frappe.get_cached_value("Company", self.company, "default_cash_account") or frappe.get_cached_value(
            "Company", self.company, "default_bank_account"
        )

        _ensure_mode_of_payment_account(TEST_MOP, self.company)
        _ensure_mode_of_payment_account(TEST_MOP, self.company)

        rows = frappe.get_doc("Mode of Payment", TEST_MOP).accounts
        self.assertEqual([(r.company, r.default_account) for r in rows], [(self.company, expected)])
