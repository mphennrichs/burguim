# Copyright (c) 2026, Tridz Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt
#
# Coverage for get_module_records - the Read side of "CRUD de usuários"
# (Usuário screen's list) and of every other generic "management" list
# screen (Item, Branch, ...). Two real incidents live here, neither ever
# covered by a test before this session:
#   1. frappe.get_all()'s default limit_page_length=20 silently truncated
#      these "show everything" screens - a User that genuinely existed was
#      missing from our own Usuário list, looked exactly like a failed
#      delete. Fixed with limit_page_length=0.
#   2. Before an allowlist existed, `doctype` came straight from the
#      client into frappe.get_all(..., fields=["*"]) with no permission
#      check and no field restriction - any authenticated user, any role,
#      could dump the full User table (and any other doctype) including
#      sensitive fields. Fixed via ALLOWED_MODULE_DOCTYPES +
#      SAFE_FIELDS_BY_DOCTYPE.
# Real DB (FrappeTestCase), no mocks - both bugs only ever show up against
# a real frappe.get_all() call.

import frappe
from frappe.tests.utils import FrappeTestCase

from ury.ury.api.dashboard import get_module_records

TEST_USER_PREFIX = "test_dashboard_crud_user_"
TEST_CASHIER_EMAIL = "test_dashboard_crud_cashier@example.com"


class TestGetModuleRecords(FrappeTestCase):
    def setUp(self):
        frappe.set_user("Administrator")
        self._cleanup()

    def tearDown(self):
        frappe.set_user("Administrator")
        self._cleanup()

    def _cleanup(self):
        frappe.set_user("Administrator")
        for name in frappe.get_all("User", filters={"email": ["like", f"{TEST_USER_PREFIX}%"]}, pluck="name"):
            frappe.delete_doc("User", name, ignore_permissions=True, force=1)
        if frappe.db.exists("User", TEST_CASHIER_EMAIL):
            frappe.delete_doc("User", TEST_CASHIER_EMAIL, ignore_permissions=True, force=1)
        frappe.db.commit()

    def _make_cashier_user(self):
        user = frappe.get_doc({
            "doctype": "User", "email": TEST_CASHIER_EMAIL, "first_name": "Test Dashboard Cashier",
            "send_welcome_email": 0, "enabled": 1,
        })
        user.insert(ignore_permissions=True)
        user.add_roles("URY Cashier")
        return user

    def test_returns_more_than_twenty_users_without_truncation(self):
        """The core regression: frappe.get_all's default page size is 20 -
        a 'list everything' screen must never silently cut off at that."""
        for i in range(25):
            frappe.get_doc({
                "doctype": "User", "email": f"{TEST_USER_PREFIX}{i}@example.com",
                "first_name": f"Test Dashboard User {i}", "send_welcome_email": 0, "enabled": 1,
            }).insert(ignore_permissions=True)

        records = get_module_records("User")

        matched = [r for r in records if r["email"].startswith(TEST_USER_PREFIX)]
        self.assertEqual(len(matched), 25, "All 25 test users must come back, not just the first 20.")

    def test_rejects_doctype_outside_the_allowlist(self):
        """Pre-fix behaviour: any doctype name was accepted and handed
        straight to frappe.get_all(fields=['*']) with no permission check."""
        records = get_module_records("Error Log")

        self.assertEqual(records, [], "A doctype outside ALLOWED_MODULE_DOCTYPES must return nothing.")

    def test_rejects_nonexistent_doctype(self):
        records = get_module_records("Not A Real Doctype")

        self.assertEqual(records, [])

    def test_user_records_are_restricted_to_the_safe_field_list(self):
        """Pre-fix behaviour: fields=['*'] on User leaked everything,
        including secrets like the API key/secret and password hash."""
        self._make_cashier_user()

        records = get_module_records("User")
        match = next(r for r in records if r["email"] == TEST_CASHIER_EMAIL)

        self.assertNotIn("api_secret", match)
        self.assertNotIn("password", match)
        self.assertEqual(
            set(match.keys()) - {"roles"},
            {"name", "email", "first_name", "last_name", "full_name", "user_type", "enabled"},
        )

    def test_user_records_include_assigned_roles(self):
        self._make_cashier_user()

        records = get_module_records("User")
        match = next(r for r in records if r["email"] == TEST_CASHIER_EMAIL)

        role_names = {row["role"] for row in match["roles"]}
        self.assertIn("URY Cashier", role_names)
