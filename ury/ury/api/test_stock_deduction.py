# Copyright (c) 2026, Tridz Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt
#
# Regression coverage for the deduct-stock-at-creation rework (moved from
# deduct-at-pickup/delivery to deduct_stock_for_order, split by
# custom_needs_prep for the Refrigerante-always-returns cancel rule). A
# code review found a real bug in the first version of the split (two
# groups each independently "reserving" the same shared ingredient) -
# this hits the real FEFO/batch allocation (FrappeTestCase, real Stock
# Entries via record_purchase), not a mock of _available_batches, so the
# same class of bug can't hide behind a mock's assumptions again.

import frappe
from frappe.tests.utils import FrappeTestCase

from ury.ury.api.stock_test_utils import cancel_stock_entries_for

from ury.ury.api.stock_entry import _resolve_warehouse
from frappe.utils import flt

from ury.ury.api.stock_entry import record_purchase
from ury.ury.api.stock_deduction import (
    deduct_stock_for_order,
    reverse_stock_for_order,
    compute_deduction_rows_and_shortfalls,
)

TEST_BRANCH = "_Test StockDed Branch"
TEST_MANAGER_EMAIL = "test_stockded_manager@example.com"
TEST_POS_PROFILE = "_Test StockDed POS Profile"
TEST_INGREDIENT = "_Test StockDed Pao"
TEST_RESOLD = "_Test StockDed Refrigerante"
TEST_RECEITA = "_Test StockDed Combo"
TEST_INVOICE_NAME = "_Test StockDed Invoice 1"


class TestStockDeduction(FrappeTestCase):
    def setUp(self):
        frappe.set_user("Administrator")
        self._cleanup()
        self.company = self._resolve_or_make_company()
        self.manager = self._make_manager_user()
        self.branch = self._make_branch()
        self.pos_profile = self._make_pos_profile()
        self.ingredient = self._make_ingredient()
        self.resold = self._make_resold_item()
        self.receita_item, self.bom = self._make_receita_using_ingredient(qty_per_unit=1)

    def tearDown(self):
        frappe.set_user("Administrator")
        self._cleanup()

    # -- fixtures -------------------------------------------------------

    def _resolve_or_make_company(self):
        existing = frappe.get_all("Company", limit=1, pluck="name")
        if existing:
            return existing[0]
        comp = frappe.get_doc({
            "doctype": "Company", "company_name": "_Test StockDed Co", "default_currency": "INR",
        })
        comp.insert(ignore_permissions=True)
        return comp.name

    def _make_manager_user(self):
        if frappe.db.exists("User", TEST_MANAGER_EMAIL):
            user = frappe.get_doc("User", TEST_MANAGER_EMAIL)
        else:
            user = frappe.get_doc({
                "doctype": "User", "email": TEST_MANAGER_EMAIL, "first_name": "Test StockDed Manager",
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

    def _item_group(self):
        return frappe.db.get_value("Item Group", {"is_group": 0}, "name")

    def _make_ingredient(self):
        if frappe.db.exists("Item", TEST_INGREDIENT):
            frappe.delete_doc("Item", TEST_INGREDIENT, ignore_permissions=True, force=1)
        item = frappe.get_doc({
            "doctype": "Item", "item_code": TEST_INGREDIENT, "item_name": TEST_INGREDIENT,
            "item_group": self._item_group(), "stock_uom": "Nos",
            "is_stock_item": 1, "has_batch_no": 1, "is_sales_item": 0,
        })
        item.insert(ignore_permissions=True)
        return item

    def _make_resold_item(self):
        """has_batch_no=1, no BOM - sold exactly as bought (ex: Refrigerante)."""
        if frappe.db.exists("Item", TEST_RESOLD):
            frappe.delete_doc("Item", TEST_RESOLD, ignore_permissions=True, force=1)
        item = frappe.get_doc({
            "doctype": "Item", "item_code": TEST_RESOLD, "item_name": TEST_RESOLD,
            "item_group": self._item_group(), "stock_uom": "Nos",
            "is_stock_item": 1, "has_batch_no": 1, "is_sales_item": 1,
        })
        item.insert(ignore_permissions=True)
        return item

    def _make_receita_using_ingredient(self, qty_per_unit):
        """A Produto/Preparo WITHOUT its own batch (has_batch_no=0), with a
        default BOM consuming `qty_per_unit` of TEST_INGREDIENT (and, for
        the aggregation-bug regression test, optionally TEST_RESOLD too)."""
        if frappe.db.exists("Item", TEST_RECEITA):
            frappe.delete_doc("Item", TEST_RECEITA, ignore_permissions=True, force=1)
        receita_item = frappe.get_doc({
            "doctype": "Item", "item_code": TEST_RECEITA, "item_name": TEST_RECEITA,
            "item_group": self._item_group(), "stock_uom": "Nos",
            "is_stock_item": 0, "has_batch_no": 0, "is_sales_item": 1,
        })
        receita_item.insert(ignore_permissions=True)

        bom = frappe.get_doc({
            "doctype": "BOM",
            "item": TEST_RECEITA,
            "quantity": 1,
            "is_active": 1,
            "is_default": 1,
            "items": [{"item_code": TEST_INGREDIENT, "qty": qty_per_unit, "uom": "Nos", "stock_uom": "Nos", "conversion_factor": 1}],
        })
        bom.insert(ignore_permissions=True)
        bom.submit()
        return receita_item, bom

    def _purchase(self, item_code, qty, rate=1):
        frappe.set_user(self.manager.name)
        record_purchase(item_code, qty, rate)
        frappe.set_user("Administrator")

    def _cleanup(self):
        frappe.set_user("Administrator")
        cancel_stock_entries_for([TEST_RECEITA, TEST_RESOLD, TEST_INGREDIENT])
        for name in frappe.get_all("BOM", filters={"item": TEST_RECEITA}, pluck="name"):
            doc = frappe.get_doc("BOM", name)
            if doc.docstatus == 1:
                doc.cancel()
            frappe.delete_doc("BOM", name, ignore_permissions=True, force=1)
        for item_code in (TEST_RECEITA, TEST_RESOLD, TEST_INGREDIENT):
            if frappe.db.exists("Item", item_code):
                frappe.delete_doc("Item", item_code, ignore_permissions=True, force=1)
        if frappe.db.exists("POS Profile", TEST_POS_PROFILE):
            frappe.delete_doc("POS Profile", TEST_POS_PROFILE, ignore_permissions=True, force=1)
        if frappe.db.exists("Branch", TEST_BRANCH):
            frappe.delete_doc("Branch", TEST_BRANCH, ignore_permissions=True, force=1)
        frappe.db.commit()

    def _stock_qty(self, item_code):
        warehouse = _resolve_warehouse(item_code, TEST_BRANCH)
        return flt(frappe.db.get_value("Bin", {"item_code": item_code, "warehouse": warehouse}, "actual_qty") or 0)

    # -- deduct_stock_for_order: basic behaviour -----------------------------

    def test_deduct_stock_for_order_explodes_bom_and_deducts(self):
        self._purchase(TEST_INGREDIENT, qty=10, rate=1)
        before = self._stock_qty(TEST_INGREDIENT)

        frappe.set_user(self.manager.name)
        deduct_stock_for_order(
            [{"item_code": TEST_RECEITA, "qty": 2}], self.branch.name, TEST_INVOICE_NAME,
        )

        after = self._stock_qty(TEST_INGREDIENT)
        self.assertEqual(before - after, 2, "2x Receita needing 1 ingredient each should deduct 2 units total.")

    def test_deduct_stock_for_order_tags_entry_with_invoice_and_needs_prep(self):
        self._purchase(TEST_INGREDIENT, qty=10, rate=1)
        frappe.set_user(self.manager.name)

        deduct_stock_for_order([{"item_code": TEST_RECEITA, "qty": 1}], self.branch.name, TEST_INVOICE_NAME)

        entries = frappe.get_all(
            "Stock Entry",
            filters={"custom_source_invoice": f"POS Invoice:{TEST_INVOICE_NAME}", "docstatus": 1},
            fields=["name", "custom_needs_prep"],
        )
        self.assertEqual(len(entries), 1)
        self.assertEqual(entries[0].custom_needs_prep, 1, "A Receita (BOM) item must be tagged needs_prep=1.")

    def test_deduct_stock_for_order_resold_item_tagged_needs_prep_false(self):
        self._purchase(TEST_RESOLD, qty=10, rate=1)
        frappe.set_user(self.manager.name)

        deduct_stock_for_order([{"item_code": TEST_RESOLD, "qty": 1}], self.branch.name, TEST_INVOICE_NAME)

        entries = frappe.get_all(
            "Stock Entry",
            filters={"custom_source_invoice": f"POS Invoice:{TEST_INVOICE_NAME}", "docstatus": 1},
            fields=["name", "custom_needs_prep"],
        )
        self.assertEqual(len(entries), 1)
        self.assertEqual(entries[0].custom_needs_prep, 0, "A resold (has_batch_no, no BOM) item must be needs_prep=0.")

    def test_deduct_stock_for_order_blocks_when_insufficient_and_flag_on(self):
        self._purchase(TEST_INGREDIENT, qty=1, rate=1)
        frappe.db.set_single_value("URY Stock Settings", "block_sale_on_insufficient_stock", 1)
        frappe.set_user(self.manager.name)

        with self.assertRaises(frappe.ValidationError):
            deduct_stock_for_order([{"item_code": TEST_RECEITA, "qty": 5}], self.branch.name, TEST_INVOICE_NAME)

    def test_deduct_stock_for_order_does_not_block_when_flag_off(self):
        self._purchase(TEST_INGREDIENT, qty=1, rate=1)
        frappe.db.set_single_value("URY Stock Settings", "block_sale_on_insufficient_stock", 0)
        frappe.set_user(self.manager.name)

        # Must not raise, even though only 1 of 5 needed is available.
        deduct_stock_for_order([{"item_code": TEST_RECEITA, "qty": 5}], self.branch.name, TEST_INVOICE_NAME)

    # -- regression: cross-group aggregation (the bug the code review found) --

    def test_mixed_cart_shares_one_ingredient_pool_across_needs_prep_groups(self):
        """The actual regression: a Produto sold directly (resold, no prep)
        that's ALSO used as a BOM ingredient inside another Produto in the
        SAME cart must draw from ONE shared pool, not have each "group"
        (needs-prep vs resold) see the full pre-sale quantity independently.
        """
        # Make TEST_RESOLD double as both a directly-sold item AND an
        # ingredient of a second Receita, all in the same cart.
        combo_item = "_Test StockDed Combo With Resold"
        if frappe.db.exists("Item", combo_item):
            frappe.delete_doc("Item", combo_item, ignore_permissions=True, force=1)
        frappe.get_doc({
            "doctype": "Item", "item_code": combo_item, "item_name": combo_item,
            "item_group": self._item_group(), "stock_uom": "Nos",
            "is_stock_item": 0, "has_batch_no": 0, "is_sales_item": 1,
        }).insert(ignore_permissions=True)
        bom = frappe.get_doc({
            "doctype": "BOM", "item": combo_item, "quantity": 1, "is_active": 1, "is_default": 1,
            "items": [{"item_code": TEST_RESOLD, "qty": 1, "uom": "Nos", "stock_uom": "Nos", "conversion_factor": 1}],
        })
        bom.insert(ignore_permissions=True)
        bom.submit()

        try:
            self._purchase(TEST_RESOLD, qty=5, rate=1)
            frappe.db.set_single_value("URY Stock Settings", "block_sale_on_insufficient_stock", 1)
            frappe.set_user(self.manager.name)

            # 3 sold directly (resold group) + 3 via combo_item's BOM
            # (needs-prep group) = 6 needed, only 5 available - must throw.
            with self.assertRaises(
                frappe.ValidationError,
                msg="Each group independently seeing 5 available (instead of sharing one pool of 5) "
                "would wrongly let this succeed - regression for the aggregation bug the code review found.",
            ):
                deduct_stock_for_order(
                    [
                        {"item_code": TEST_RESOLD, "qty": 3},
                        {"item_code": combo_item, "qty": 3},
                    ],
                    self.branch.name,
                    TEST_INVOICE_NAME,
                )
        finally:
            frappe.set_user("Administrator")
            if bom.docstatus == 1:
                bom.cancel()
            frappe.delete_doc("BOM", bom.name, ignore_permissions=True, force=1)
            frappe.delete_doc("Item", combo_item, ignore_permissions=True, force=1)

    # -- reverse_stock_for_order -----------------------------------------

    def test_reverse_stock_for_order_restores_quantity(self):
        self._purchase(TEST_INGREDIENT, qty=10, rate=1)
        frappe.set_user(self.manager.name)
        deduct_stock_for_order([{"item_code": TEST_RECEITA, "qty": 2}], self.branch.name, TEST_INVOICE_NAME)
        after_deduct = self._stock_qty(TEST_INGREDIENT)

        reverse_stock_for_order(TEST_INVOICE_NAME)

        after_reverse = self._stock_qty(TEST_INGREDIENT)
        self.assertEqual(after_reverse - after_deduct, 2, "Reversing must put back exactly what was deducted.")

    def test_reverse_stock_for_order_filters_by_needs_prep(self):
        """resold items must always be reversible independently of the
        needs-prep items in the same order - the whole point of the split."""
        self._purchase(TEST_INGREDIENT, qty=10, rate=1)
        self._purchase(TEST_RESOLD, qty=10, rate=1)
        frappe.set_user(self.manager.name)
        deduct_stock_for_order(
            [{"item_code": TEST_RECEITA, "qty": 1}, {"item_code": TEST_RESOLD, "qty": 1}],
            self.branch.name,
            TEST_INVOICE_NAME,
        )
        ingredient_after_deduct = self._stock_qty(TEST_INGREDIENT)
        resold_after_deduct = self._stock_qty(TEST_RESOLD)

        # Reverse ONLY the resold (needs_prep=0) half.
        reverse_stock_for_order(TEST_INVOICE_NAME, needs_prep=0)

        self.assertEqual(
            self._stock_qty(TEST_RESOLD) - resold_after_deduct, 1,
            "needs_prep=0 reversal must restore the resold item.",
        )
        self.assertEqual(
            self._stock_qty(TEST_INGREDIENT), ingredient_after_deduct,
            "needs_prep=0 reversal must NOT touch the needs-prep (BOM) group.",
        )

    # -- compute_deduction_rows_and_shortfalls (used by the legacy on_submit path) --

    def test_compute_deduction_rows_and_shortfalls_reports_shortfall(self):
        self._purchase(TEST_INGREDIENT, qty=1, rate=1)
        rows, shortfalls = compute_deduction_rows_and_shortfalls(
            [{"item_code": TEST_RECEITA, "qty": 5}], self.branch.name,
        )
        self.assertEqual(len(shortfalls), 1)
        self.assertEqual(shortfalls[0][0], TEST_INGREDIENT)
        self.assertEqual(flt(shortfalls[0][1]), 4)
