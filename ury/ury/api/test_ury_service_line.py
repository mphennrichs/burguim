import frappe
from frappe.tests.utils import FrappeTestCase
from unittest.mock import patch, MagicMock
from datetime import datetime
from ury.ury.api.ury_service_line import get_running_low


class TestGetRunningLow(FrappeTestCase):

    @patch("ury.ury.api.ury_service_line.frappe.cache")
    def test_cache_hit_returns_immediately(self, mock_cache_obj):
        mock_cache_instance = MagicMock()
        mock_cache_obj.return_value = mock_cache_instance
        cached_data = [
            {
                "item_code": "ITEM1",
                "item_name": "Item One",
                "remaining": 50,
                "qty_sold_today": 10,
                "eta_minutes": 300,
                "data_quality_issue": False,
            }
        ]
        mock_cache_instance.get_value.return_value = cached_data

        result = get_running_low(branch="URY Branch")

        self.assertEqual(result, cached_data)
        mock_cache_instance.get_value.assert_called_once()

    @patch("ury.ury.api.ury_service_line.frappe.cache")
    @patch("ury.ury.api.ury_service_line.frappe.db.get_value")
    @patch("ury.ury.api.ury_service_line.frappe.db.sql")
    @patch("ury.ury.api.ury_service_line.get_datetime")
    @patch("ury.ury.api.ury_service_line.today")
    def test_running_low_with_items(self, mock_today, mock_get_datetime, mock_sql, mock_get_value, mock_cache_obj):
        mock_cache_instance = MagicMock()
        mock_cache_obj.return_value = mock_cache_instance
        mock_cache_instance.get_value.return_value = None

        mock_today.return_value = "2026-08-19"
        shift_start = datetime(2026, 8, 19, 0, 0, 0)
        current_time = datetime(2026, 8, 19, 4, 0, 0)
        mock_get_datetime.side_effect = [shift_start, current_time]

        mock_sql.return_value = [
            frappe._dict({
                "item_code": "ITEM1",
                "item_name": "Item One",
                "qty_sold": 10,
            })
        ]

        mock_get_value.side_effect = ["Kitchen - U", 50]

        result = get_running_low(branch="URY Branch")

        self.assertGreater(len(result), 0)
        first_item = result[0]
        self.assertEqual(first_item["item_code"], "ITEM1")
        self.assertEqual(first_item["remaining"], 50)
        self.assertEqual(first_item["qty_sold_today"], 10)
        self.assertIsNotNone(first_item["eta_minutes"])
        self.assertGreater(first_item["eta_minutes"], 0)
        self.assertFalse(first_item["data_quality_issue"])

    @patch("ury.ury.api.ury_service_line.frappe.cache")
    @patch("ury.ury.api.ury_service_line.frappe.db.get_value")
    @patch("ury.ury.api.ury_service_line.frappe.db.sql")
    @patch("ury.ury.api.ury_service_line.get_datetime")
    @patch("ury.ury.api.ury_service_line.today")
    def test_running_low_negative_stock_flags_data_quality(self, mock_today, mock_get_datetime, mock_sql, mock_get_value, mock_cache_obj):
        mock_cache_instance = MagicMock()
        mock_cache_obj.return_value = mock_cache_instance
        mock_cache_instance.get_value.return_value = None

        mock_today.return_value = "2026-08-19"
        shift_start = datetime(2026, 8, 19, 0, 0, 0)
        current_time = datetime(2026, 8, 19, 2, 0, 0)
        mock_get_datetime.side_effect = [shift_start, current_time]

        mock_sql.return_value = [
            frappe._dict({
                "item_code": "ITEM2",
                "item_name": "Item Two",
                "qty_sold": 5,
            })
        ]

        mock_get_value.side_effect = ["Kitchen - U", -20]

        result = get_running_low(branch="URY Branch")

        first_item = result[0]
        self.assertTrue(first_item["data_quality_issue"])
        self.assertEqual(first_item["remaining"], 0)

    @patch("ury.ury.api.ury_service_line.frappe.cache")
    @patch("ury.ury.api.ury_service_line.frappe.db.get_value")
    @patch("ury.ury.api.ury_service_line.frappe.db.sql")
    @patch("ury.ury.api.ury_service_line.get_datetime")
    @patch("ury.ury.api.ury_service_line.today")
    def test_running_low_no_items_sold(self, mock_today, mock_get_datetime, mock_sql, mock_get_value, mock_cache_obj):
        mock_cache_instance = MagicMock()
        mock_cache_obj.return_value = mock_cache_instance
        mock_cache_instance.get_value.return_value = None

        mock_today.return_value = "2026-08-19"
        shift_start = datetime(2026, 8, 19, 0, 0, 0)
        current_time = datetime(2026, 8, 19, 2, 0, 0)
        mock_get_datetime.side_effect = [shift_start, current_time]

        mock_sql.return_value = []

        result = get_running_low(branch="URY Branch")

        self.assertEqual(result, [])
        # The POS Profile warehouse lookup is gated only on `branch` being
        # truthy, not on whether any items sold — it always fires once here
        # since branch="URY Branch". The per-item Bin lookup inside the sold
        # items loop is what's skipped when there's nothing sold.
        mock_get_value.assert_called_once_with("POS Profile", {"branch": "URY Branch"}, "warehouse")

    @patch("ury.ury.api.ury_service_line.frappe.cache")
    @patch("ury.ury.api.ury_service_line.frappe.db.get_value")
    @patch("ury.ury.api.ury_service_line.frappe.db.sql")
    @patch("ury.ury.api.ury_service_line.get_datetime")
    @patch("ury.ury.api.ury_service_line.today")
    def test_running_low_no_branch(self, mock_today, mock_get_datetime, mock_sql, mock_get_value, mock_cache_obj):
        mock_cache_instance = MagicMock()
        mock_cache_obj.return_value = mock_cache_instance
        mock_cache_instance.get_value.return_value = None

        mock_today.return_value = "2026-08-19"
        shift_start = datetime(2026, 8, 19, 0, 0, 0)
        current_time = datetime(2026, 8, 19, 3, 0, 0)
        mock_get_datetime.side_effect = [shift_start, current_time]

        mock_sql.return_value = [
            frappe._dict({
                "item_code": "ITEM3",
                "item_name": "Item Three",
                "qty_sold": 20,
            })
        ]

        # branch=None skips the POS Profile warehouse lookup entirely (see
        # `if branch:` guard in get_running_low), so only the per-item Bin
        # lookup fires — a single call, not two.
        mock_get_value.side_effect = [100]

        result = get_running_low(branch=None)

        self.assertGreater(len(result), 0)
        first_item = result[0]
        self.assertEqual(first_item["item_code"], "ITEM3")
        self.assertEqual(first_item["remaining"], 100)
