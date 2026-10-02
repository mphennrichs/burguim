# Copyright (c) 2026, Tridz Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt
#
# Regression coverage for rename_course/delete_course - rename_course
# shipped broken ("rename_doc() got an unexpected keyword argument
# 'ignore_permissions'") because nothing exercised it against a real
# Frappe install; a mock of frappe.rename_doc would have hidden the same
# signature mismatch, so this hits the real function (FrappeTestCase,
# same pattern as ury_pos/test_e2e_p0_p1_flow.py).

import frappe
from frappe.tests.utils import FrappeTestCase

from ury.ury.api.menu import rename_course, delete_course

TEST_BRANCH = "_Test Menu API Branch"
TEST_USER_EMAIL = "test_menu_api_manager@example.com"
TEST_COURSE_OLD = "_Test Course Old"
TEST_COURSE_NEW = "_Test Course New"
TEST_COURSE_OTHER = "_Test Course Other"
TEST_MENU = "_Test Menu API Menu"
TEST_ITEM = "_Test Menu API Item"


class TestMenuCourseApi(FrappeTestCase):
    def setUp(self):
        frappe.set_user("Administrator")
        self._cleanup()
        self.manager = self._make_manager_user()
        self.branch = self._make_branch()

    def tearDown(self):
        frappe.set_user("Administrator")
        self._cleanup()

    def _make_manager_user(self):
        if frappe.db.exists("User", TEST_USER_EMAIL):
            user = frappe.get_doc("User", TEST_USER_EMAIL)
        else:
            user = frappe.get_doc({
                "doctype": "User",
                "email": TEST_USER_EMAIL,
                "first_name": "Test Menu API Manager",
                "send_welcome_email": 0,
                "enabled": 1,
            })
            user.insert(ignore_permissions=True)
        if "URY Manager" not in frappe.get_roles(user.name):
            user.add_roles("URY Manager")
        return user

    def _make_branch(self):
        # getBranch() (called by both rename_course/delete_course purely
        # as an auth gate here) resolves via Branch's "user" child table -
        # see ury_pos/api.py:getBranch.
        if frappe.db.exists("Branch", TEST_BRANCH):
            branch = frappe.get_doc("Branch", TEST_BRANCH)
            branch.set("user", [])
            branch.append("user", {"user": self.manager.name})
            branch.save(ignore_permissions=True)
        else:
            branch = frappe.get_doc({
                "doctype": "Branch",
                "branch": TEST_BRANCH,
                "user": [{"user": self.manager.name}],
            })
            branch.insert(ignore_permissions=True)
        return branch

    def _make_course(self, name=TEST_COURSE_OLD, icon="Utensils"):
        if frappe.db.exists("URY Menu Course", name):
            frappe.delete_doc("URY Menu Course", name, ignore_permissions=True, force=1)
        course = frappe.get_doc({"doctype": "URY Menu Course", "course": name, "icon": icon})
        course.insert(ignore_permissions=True)
        return course

    def _make_menu_item_referencing(self, course_name):
        if frappe.db.exists("Item", TEST_ITEM):
            frappe.delete_doc("Item", TEST_ITEM, ignore_permissions=True, force=1)
        item_group = frappe.db.get_value("Item Group", {"is_group": 0}, "name")
        frappe.get_doc({
            "doctype": "Item",
            "item_code": TEST_ITEM,
            "item_name": TEST_ITEM,
            "item_group": item_group,
            "stock_uom": "Nos",
            "is_stock_item": 0,
            "is_sales_item": 1,
        }).insert(ignore_permissions=True)

        if frappe.db.exists("URY Menu", TEST_MENU):
            frappe.delete_doc("URY Menu", TEST_MENU, ignore_permissions=True, force=1)
        menu = frappe.get_doc({
            "doctype": "URY Menu",
            "name": TEST_MENU,
            "branch": self.branch.name,
            "enabled": 1,
            "items": [{
                "item": TEST_ITEM,
                "item_name": TEST_ITEM,
                "rate": 10,
                "course": course_name,
            }],
        })
        menu.insert(ignore_permissions=True)
        return menu

    def _cleanup(self):
        frappe.set_user("Administrator")
        if frappe.db.exists("URY Menu", TEST_MENU):
            frappe.delete_doc("URY Menu", TEST_MENU, ignore_permissions=True, force=1)
        if frappe.db.exists("Item", TEST_ITEM):
            frappe.delete_doc("Item", TEST_ITEM, ignore_permissions=True, force=1)
        for name in (TEST_COURSE_OLD, TEST_COURSE_NEW, TEST_COURSE_OTHER):
            if frappe.db.exists("URY Menu Course", name):
                frappe.delete_doc("URY Menu Course", name, ignore_permissions=True, force=1)
        if frappe.db.exists("Branch", TEST_BRANCH):
            frappe.delete_doc("Branch", TEST_BRANCH, ignore_permissions=True, force=1)
        frappe.db.commit()

    # -- rename_course --------------------------------------------------

    def test_rename_course_actually_renames(self):
        """Regression: frappe.rename_doc(..., ignore_permissions=True) threw
        TypeError on this Frappe version - confirm the real call succeeds
        end to end, not just that it doesn't raise."""
        self._make_course()
        frappe.set_user(self.manager.name)

        result = rename_course(TEST_COURSE_OLD, TEST_COURSE_NEW)

        self.assertEqual(result["name"], TEST_COURSE_NEW)
        self.assertFalse(frappe.db.exists("URY Menu Course", TEST_COURSE_OLD))
        self.assertTrue(frappe.db.exists("URY Menu Course", TEST_COURSE_NEW))

    def test_rename_course_repoints_linked_menu_items(self):
        """URY Menu Item.course is a real Link - rename_doc's own
        update_linked_doctypes pass should repoint it automatically."""
        course = self._make_course()
        self._make_menu_item_referencing(course.name)
        frappe.set_user(self.manager.name)

        rename_course(TEST_COURSE_OLD, TEST_COURSE_NEW)

        menu = frappe.get_doc("URY Menu", TEST_MENU)
        self.assertEqual(menu.items[0].course, TEST_COURSE_NEW)

    def test_rename_course_updates_icon(self):
        self._make_course(icon="Utensils")
        frappe.set_user(self.manager.name)

        rename_course(TEST_COURSE_OLD, TEST_COURSE_NEW, icon="Pizza")

        self.assertEqual(frappe.db.get_value("URY Menu Course", TEST_COURSE_NEW, "icon"), "Pizza")

    def test_rename_course_same_name_only_updates_icon(self):
        self._make_course(icon="Utensils")
        frappe.set_user(self.manager.name)

        result = rename_course(TEST_COURSE_OLD, TEST_COURSE_OLD, icon="Pizza")

        self.assertEqual(result["name"], TEST_COURSE_OLD)
        self.assertEqual(frappe.db.get_value("URY Menu Course", TEST_COURSE_OLD, "icon"), "Pizza")

    def test_rename_course_rejects_duplicate_name(self):
        self._make_course(TEST_COURSE_OLD)
        self._make_course(TEST_COURSE_OTHER)
        frappe.set_user(self.manager.name)

        with self.assertRaises(frappe.ValidationError):
            rename_course(TEST_COURSE_OLD, TEST_COURSE_OTHER)

    def test_rename_course_rejects_empty_name(self):
        self._make_course()
        frappe.set_user(self.manager.name)

        with self.assertRaises(frappe.ValidationError):
            rename_course(TEST_COURSE_OLD, "   ")

    # -- delete_course ----------------------------------------------------

    def test_delete_course_removes_unused_course(self):
        self._make_course()
        frappe.set_user(self.manager.name)

        result = delete_course(TEST_COURSE_OLD)

        self.assertEqual(result["deleted"], TEST_COURSE_OLD)
        self.assertFalse(frappe.db.exists("URY Menu Course", TEST_COURSE_OLD))

    def test_delete_course_blocked_when_menu_item_uses_it(self):
        course = self._make_course()
        self._make_menu_item_referencing(course.name)
        frappe.set_user(self.manager.name)

        with self.assertRaises(frappe.ValidationError):
            delete_course(TEST_COURSE_OLD)

        self.assertTrue(frappe.db.exists("URY Menu Course", TEST_COURSE_OLD))
