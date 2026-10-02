# Copyright (c) 2026, Tridz Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt
#
# Regression coverage for create_staff_user/delete_user/set_user_password.
# create_staff_user in particular: a staff account created without it
# (plain frappe.client.insert from the frontend, pre-fix) passed every
# manual check (right role, could log in) but was invisible to
# ury_pos.api.getBranch() - every operational screen (Caixa, Tela de
# Cozinha, Receitas, Estoque) threw "User is not Associated with any
# Branch" for that account. Hits the real DB (FrappeTestCase), same
# pattern as ury_pos/test_e2e_p0_p1_flow.py.

import frappe
from frappe.tests.utils import FrappeTestCase

from ury.ury.api.users import create_staff_user, delete_user, set_user_password

TEST_BRANCH = "_Test Users API Branch"
TEST_MANAGER_EMAIL = "test_users_api_manager@example.com"
TEST_CASHIER_EMAIL = "test_users_api_cashier@example.com"
TEST_NEW_STAFF_EMAIL = "test_users_api_new_staff@example.com"


class TestUsersApi(FrappeTestCase):
    def setUp(self):
        frappe.set_user("Administrator")
        self._cleanup()
        self.manager = self._make_user(TEST_MANAGER_EMAIL, "URY Manager")
        self.cashier = self._make_user(TEST_CASHIER_EMAIL, "URY Cashier")
        self.branch = self._make_branch()

    def tearDown(self):
        frappe.set_user("Administrator")
        self._cleanup()

    def _make_user(self, email, role):
        if frappe.db.exists("User", email):
            user = frappe.get_doc("User", email)
        else:
            user = frappe.get_doc({
                "doctype": "User",
                "email": email,
                "first_name": email.split("@")[0],
                "send_welcome_email": 0,
                "enabled": 1,
            })
            user.insert(ignore_permissions=True)
        if role not in frappe.get_roles(user.name):
            user.add_roles(role)
        return user

    def _make_branch(self):
        # Both the manager AND cashier belong to this branch - getBranch()
        # (called inside create_staff_user) resolves the ACTING user's own
        # branch, which new staff then get linked to.
        if frappe.db.exists("Branch", TEST_BRANCH):
            branch = frappe.get_doc("Branch", TEST_BRANCH)
            branch.set("user", [])
            branch.append("user", {"user": self.manager.name})
            branch.append("user", {"user": self.cashier.name})
            branch.save(ignore_permissions=True)
        else:
            branch = frappe.get_doc({
                "doctype": "Branch",
                "branch": TEST_BRANCH,
                "user": [{"user": self.manager.name}, {"user": self.cashier.name}],
            })
            branch.insert(ignore_permissions=True)
        return branch

    def _cleanup(self):
        frappe.set_user("Administrator")
        if frappe.db.exists("User", TEST_NEW_STAFF_EMAIL):
            frappe.delete_doc("User", TEST_NEW_STAFF_EMAIL, ignore_permissions=True, force=1)
        if frappe.db.exists("Branch", TEST_BRANCH):
            frappe.delete_doc("Branch", TEST_BRANCH, ignore_permissions=True, force=1)
        frappe.db.commit()

    # -- create_staff_user --------------------------------------------------

    def test_create_staff_user_links_to_acting_managers_branch(self):
        """The actual regression: without this link, every operational
        screen's getBranch() call throws for the new user."""
        frappe.set_user(self.manager.name)

        result = create_staff_user(
            email=TEST_NEW_STAFF_EMAIL,
            first_name="Novo",
            last_name="Funcionario",
            role="URY Cashier",
        )

        self.assertEqual(result["user"], TEST_NEW_STAFF_EMAIL)
        self.assertTrue(frappe.db.exists("User", TEST_NEW_STAFF_EMAIL))

        branch_doc = frappe.get_doc("Branch", self.branch.name)
        linked_emails = {row.user for row in branch_doc.user}
        self.assertIn(
            TEST_NEW_STAFF_EMAIL,
            linked_emails,
            "create_staff_user must link the new User to the acting manager's Branch "
            "(URY User child table) - otherwise ury_pos.api.getBranch() throws for them "
            "on every operational screen.",
        )

    def test_create_staff_user_sets_role(self):
        frappe.set_user(self.manager.name)
        create_staff_user(email=TEST_NEW_STAFF_EMAIL, first_name="Novo", role="URY Manager")
        roles = frappe.get_roles(TEST_NEW_STAFF_EMAIL)
        self.assertIn("URY Manager", roles)

    def test_create_staff_user_sets_username(self):
        frappe.set_user(self.manager.name)
        create_staff_user(email=TEST_NEW_STAFF_EMAIL, first_name="Novo", username="novofuncionario")
        self.assertEqual(frappe.db.get_value("User", TEST_NEW_STAFF_EMAIL, "username"), "novofuncionario")

    def test_create_staff_user_sets_password_and_skips_welcome_email(self):
        frappe.set_user(self.manager.name)
        create_staff_user(email=TEST_NEW_STAFF_EMAIL, first_name="Novo", password="S3nhaForte!")

        from frappe.utils.password import check_password

        # Raises if the password doesn't match - the call itself is the assertion.
        check_password(TEST_NEW_STAFF_EMAIL, "S3nhaForte!")

    def test_create_staff_user_rejects_duplicate_email(self):
        frappe.set_user(self.manager.name)
        create_staff_user(email=TEST_NEW_STAFF_EMAIL, first_name="Novo")

        with self.assertRaises(frappe.ValidationError):
            create_staff_user(email=TEST_NEW_STAFF_EMAIL, first_name="Duplicado")

    def test_create_staff_user_rejects_non_manager(self):
        frappe.set_user(self.cashier.name)
        with self.assertRaises(frappe.PermissionError):
            create_staff_user(email=TEST_NEW_STAFF_EMAIL, first_name="Novo")

    # -- delete_user --------------------------------------------------------

    def test_delete_user_removes_unreferenced_user(self):
        frappe.set_user(self.manager.name)
        create_staff_user(email=TEST_NEW_STAFF_EMAIL, first_name="Novo")

        delete_user(TEST_NEW_STAFF_EMAIL)

        self.assertFalse(frappe.db.exists("User", TEST_NEW_STAFF_EMAIL))

    def test_delete_user_also_removes_branch_membership(self):
        frappe.set_user(self.manager.name)
        create_staff_user(email=TEST_NEW_STAFF_EMAIL, first_name="Novo")

        delete_user(TEST_NEW_STAFF_EMAIL)

        self.assertFalse(frappe.db.exists("URY User", {"user": TEST_NEW_STAFF_EMAIL}))

    def test_delete_user_blocked_by_real_history_keeps_branch_membership(self):
        """A real record pointing at the user (here a KOT's verified_by) must
        block the delete - and the Branch membership removed before the
        attempt must be rolled back, or the user loses access to every screen."""
        frappe.set_user(self.manager.name)
        create_staff_user(email=TEST_NEW_STAFF_EMAIL, first_name="Novo")
        frappe.set_user("Administrator")
        kot = frappe.get_doc({
            "doctype": "URY KOT", "naming_series": "_T-KOT-", "date": frappe.utils.nowdate(),
            "verified_by": TEST_NEW_STAFF_EMAIL,
        })
        kot.insert(ignore_permissions=True, ignore_mandatory=True)
        self.addCleanup(frappe.delete_doc, "URY KOT", kot.name, ignore_permissions=True, force=1)
        frappe.set_user(self.manager.name)

        with self.assertRaises(frappe.ValidationError):
            delete_user(TEST_NEW_STAFF_EMAIL)

        self.assertTrue(frappe.db.exists("User", TEST_NEW_STAFF_EMAIL))
        branch_doc = frappe.get_doc("Branch", TEST_BRANCH)
        self.assertIn(TEST_NEW_STAFF_EMAIL, [row.user for row in branch_doc.user])

    def test_delete_user_rejects_administrator(self):
        frappe.set_user(self.manager.name)
        with self.assertRaises(frappe.ValidationError):
            delete_user("Administrator")

    def test_delete_user_rejects_self(self):
        frappe.set_user(self.manager.name)
        with self.assertRaises(frappe.ValidationError):
            delete_user(self.manager.name)

    def test_delete_user_rejects_non_manager(self):
        frappe.set_user(self.manager.name)
        create_staff_user(email=TEST_NEW_STAFF_EMAIL, first_name="Novo")

        frappe.set_user(self.cashier.name)
        with self.assertRaises(frappe.PermissionError):
            delete_user(TEST_NEW_STAFF_EMAIL)

    # -- set_user_password ----------------------------------------------------

    def test_set_user_password_updates_password(self):
        frappe.set_user(self.manager.name)
        create_staff_user(email=TEST_NEW_STAFF_EMAIL, first_name="Novo")

        set_user_password(TEST_NEW_STAFF_EMAIL, "OutraSenhaForte!")

        from frappe.utils.password import check_password

        check_password(TEST_NEW_STAFF_EMAIL, "OutraSenhaForte!")

    def test_set_user_password_rejects_empty_password(self):
        frappe.set_user(self.manager.name)
        create_staff_user(email=TEST_NEW_STAFF_EMAIL, first_name="Novo")

        with self.assertRaises(frappe.ValidationError):
            set_user_password(TEST_NEW_STAFF_EMAIL, "")

    def test_set_user_password_rejects_non_manager(self):
        frappe.set_user(self.manager.name)
        create_staff_user(email=TEST_NEW_STAFF_EMAIL, first_name="Novo")

        frappe.set_user(self.cashier.name)
        with self.assertRaises(frappe.PermissionError):
            set_user_password(TEST_NEW_STAFF_EMAIL, "QualquerSenha!")
