# Copyright (c) 2026, Tridz Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt
#
# CRUD coverage for Receitas (BOM) and Ingredientes/Produtos (Item) - the
# "Meu Estoque" screen's create/edit/delete flows had zero automated
# coverage before this session's test pass, same as every other module
# touched this session. Real DB (FrappeTestCase), no mocks - a rename_doc/
# delete_doc kwarg mismatch (the bug that just shipped in menu.py) would
# only ever surface this way, never behind a mock.

import frappe
from frappe.tests.utils import FrappeTestCase

from ury.ury.api.bom import (
    create_item,
    update_ingredient,
    delete_ingredient,
    disable_item,
    mark_prepared_ahead,
    delete_produto,
    create_bom,
    update_bom,
    delete_bom,
    get_boms,
)

TEST_BRANCH = "_Test Bom API Branch"
TEST_MANAGER_EMAIL = "test_bom_api_manager@example.com"
TEST_INGREDIENT_NAME = "_Test Bom API Pao"
TEST_PRODUTO_NAME = "_Test Bom API Hamburguer"


class TestBomApi(FrappeTestCase):
    def setUp(self):
        frappe.set_user("Administrator")
        self._cleanup()
        self.manager = self._make_manager_user()
        self.branch = self._make_branch()

    def tearDown(self):
        frappe.set_user("Administrator")
        self._cleanup()

    def _make_manager_user(self):
        if frappe.db.exists("User", TEST_MANAGER_EMAIL):
            user = frappe.get_doc("User", TEST_MANAGER_EMAIL)
        else:
            user = frappe.get_doc({
                "doctype": "User", "email": TEST_MANAGER_EMAIL, "first_name": "Test Bom API Manager",
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

    def _cleanup(self):
        frappe.set_user("Administrator")
        for name in frappe.get_all("BOM", filters={"item": TEST_PRODUTO_NAME}, pluck="name"):
            doc = frappe.get_doc("BOM", name)
            if doc.docstatus == 1:
                doc.cancel()
            frappe.delete_doc("BOM", name, ignore_permissions=True, force=1)
        for item_code in (TEST_PRODUTO_NAME, TEST_INGREDIENT_NAME):
            if frappe.db.exists("Item", item_code):
                frappe.delete_doc("Item", item_code, ignore_permissions=True, force=1)
        if frappe.db.exists("Branch", TEST_BRANCH):
            frappe.delete_doc("Branch", TEST_BRANCH, ignore_permissions=True, force=1)
        frappe.db.commit()

    def _create_ingredient(self):
        frappe.set_user(self.manager.name)
        return create_item(TEST_INGREDIENT_NAME, vendavel=0, rastreio_lote=1, stock_uom="Gram")

    def _create_produto_with_bom(self):
        self._create_ingredient()
        create_item(TEST_PRODUTO_NAME, vendavel=1, rastreio_lote=0)
        result = create_bom(
            TEST_PRODUTO_NAME, quantity=1, ingredients=[{"item_code": TEST_INGREDIENT_NAME, "qty": 2}],
        )
        return result["bom"]

    # -- Ingrediente CRUD -----------------------------------------------

    def test_create_item_as_ingredient(self):
        result = self._create_ingredient()
        self.assertEqual(result["item"], TEST_INGREDIENT_NAME)
        self.assertEqual(result["rastreio_lote"], 1)
        self.assertEqual(result["vendavel"], 0)
        doc = frappe.get_doc("Item", TEST_INGREDIENT_NAME)
        self.assertEqual(doc.has_batch_no, 1)
        self.assertEqual(doc.is_sales_item, 0)
        self.assertEqual(doc.is_stock_item, 1)

    def test_update_ingredient_edits_shelf_life_and_description(self):
        self._create_ingredient()
        frappe.set_user(self.manager.name)

        result = update_ingredient(TEST_INGREDIENT_NAME, shelf_life_in_days=5, description="Pão fresco")

        self.assertEqual(result["shelf_life_in_days"], 5)
        self.assertEqual(frappe.db.get_value("Item", TEST_INGREDIENT_NAME, "description"), "Pão fresco")

    def test_update_ingredient_rejects_a_produto(self):
        frappe.set_user(self.manager.name)
        create_item(TEST_PRODUTO_NAME, vendavel=1, rastreio_lote=0)

        with self.assertRaises(frappe.ValidationError):
            update_ingredient(TEST_PRODUTO_NAME, shelf_life_in_days=5)

    def test_delete_ingredient_removes_unused_item(self):
        self._create_ingredient()
        frappe.set_user(self.manager.name)

        delete_ingredient(TEST_INGREDIENT_NAME)

        self.assertFalse(frappe.db.exists("Item", TEST_INGREDIENT_NAME))

    def test_delete_ingredient_blocked_when_used_in_a_bom(self):
        self._create_produto_with_bom()
        frappe.set_user(self.manager.name)

        with self.assertRaises(frappe.ValidationError):
            delete_ingredient(TEST_INGREDIENT_NAME)

        self.assertTrue(frappe.db.exists("Item", TEST_INGREDIENT_NAME))

    def test_disable_item_keeps_it_but_marks_disabled(self):
        self._create_ingredient()
        frappe.set_user(self.manager.name)

        disable_item(TEST_INGREDIENT_NAME)

        self.assertTrue(frappe.db.exists("Item", TEST_INGREDIENT_NAME))
        self.assertEqual(frappe.db.get_value("Item", TEST_INGREDIENT_NAME, "disabled"), 1)

    # -- Produto ----------------------------------------------------------

    def test_create_item_as_produto(self):
        frappe.set_user(self.manager.name)
        result = create_item(TEST_PRODUTO_NAME, vendavel=1, rastreio_lote=0)

        self.assertEqual(result["vendavel"], 1)
        self.assertEqual(result["rastreio_lote"], 0)

    def test_mark_prepared_ahead_turns_on_batch_tracking(self):
        frappe.set_user(self.manager.name)
        create_item(TEST_PRODUTO_NAME, vendavel=1, rastreio_lote=0)

        result = mark_prepared_ahead(TEST_PRODUTO_NAME)

        self.assertEqual(result["has_batch_no"], 1)
        self.assertEqual(frappe.db.get_value("Item", TEST_PRODUTO_NAME, "has_batch_no"), 1)

    def test_mark_prepared_ahead_rejects_non_sales_item(self):
        self._create_ingredient()
        frappe.set_user(self.manager.name)

        with self.assertRaises(frappe.ValidationError):
            mark_prepared_ahead(TEST_INGREDIENT_NAME)

    def test_delete_produto_removes_unused_item(self):
        frappe.set_user(self.manager.name)
        create_item(TEST_PRODUTO_NAME, vendavel=1, rastreio_lote=0)

        delete_produto(TEST_PRODUTO_NAME)

        self.assertFalse(frappe.db.exists("Item", TEST_PRODUTO_NAME))

    # -- Receita (BOM) CRUD -------------------------------------------------

    def test_create_bom_builds_recipe_with_ingredients(self):
        bom_name = self._create_produto_with_bom()

        bom = frappe.get_doc("BOM", bom_name)
        self.assertEqual(bom.docstatus, 1)
        self.assertEqual(bom.item, TEST_PRODUTO_NAME)
        self.assertEqual(len(bom.items), 1)
        self.assertEqual(bom.items[0].item_code, TEST_INGREDIENT_NAME)
        self.assertEqual(bom.items[0].qty, 2)

    def test_create_bom_rejects_item_as_its_own_ingredient(self):
        frappe.set_user(self.manager.name)
        create_item(TEST_PRODUTO_NAME, vendavel=1, rastreio_lote=0)

        with self.assertRaises(frappe.ValidationError):
            create_bom(TEST_PRODUTO_NAME, quantity=1, ingredients=[{"item_code": TEST_PRODUTO_NAME, "qty": 1}])

    def test_create_bom_rejects_empty_ingredient_list(self):
        frappe.set_user(self.manager.name)
        create_item(TEST_PRODUTO_NAME, vendavel=1, rastreio_lote=0)

        with self.assertRaises(frappe.ValidationError):
            create_bom(TEST_PRODUTO_NAME, quantity=1, ingredients=[])

    def test_update_bom_replaces_with_new_version(self):
        old_bom_name = self._create_produto_with_bom()
        frappe.set_user(self.manager.name)

        result = update_bom(
            old_bom_name, quantity=1, ingredients=[{"item_code": TEST_INGREDIENT_NAME, "qty": 3}],
        )

        self.assertNotEqual(result["bom"], old_bom_name)
        self.assertEqual(frappe.db.get_value("BOM", old_bom_name, "docstatus"), 2, "Old version must be cancelled.")
        new_bom = frappe.get_doc("BOM", result["bom"])
        self.assertEqual(new_bom.items[0].qty, 3)
        self.assertEqual(new_bom.docstatus, 1)

    def test_get_boms_lists_active_recipe_with_ingredients(self):
        self._create_produto_with_bom()
        frappe.set_user(self.manager.name)

        boms = get_boms()["boms"]
        match = next((b for b in boms if b["item"] == TEST_PRODUTO_NAME), None)

        self.assertIsNotNone(match)
        self.assertEqual(len(match["ingredients"]), 1)
        self.assertEqual(match["ingredients"][0]["item_code"], TEST_INGREDIENT_NAME)

    def test_delete_bom_cancels_and_removes(self):
        bom_name = self._create_produto_with_bom()
        frappe.set_user(self.manager.name)

        delete_bom(bom_name)

        self.assertFalse(frappe.db.exists("BOM", bom_name))
