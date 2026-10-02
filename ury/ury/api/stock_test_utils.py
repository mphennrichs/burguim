import frappe


def cancel_stock_entries_for(item_codes):
	"""Test cleanup: cancel (never raw-delete) every submitted Stock Entry touching
	these items, newest first. A raw delete leaves the Serial and Batch Bundles and
	ledger rows behind, so the next run silently inherits the old stock; cancelling
	oldest-first drives a batch negative (purchase undone before what consumed it)."""
	names = frappe.get_all(
		"Stock Entry Detail",
		filters={"item_code": ["in", list(item_codes)], "docstatus": 1},
		pluck="parent",
		distinct=True,
	)
	for name in sorted(set(names), key=lambda n: frappe.db.get_value("Stock Entry", n, "creation"), reverse=True):
		frappe.get_doc("Stock Entry", name).cancel()


def make_restaurant(name, branch, company, menu, pos_profile, series_prefix):
	"""Caixa/Cozinha resolve the menu via POS Profile.restaurant -> URY Restaurant.active_menu;
	URY Restaurant in turn requires a default_room (URY Room)."""
	delete_restaurant(name)
	room = frappe.get_doc({"doctype": "URY Room", "name": f"{name} Room", "branch": branch})
	room.insert(ignore_permissions=True)
	frappe.get_doc({
		"doctype": "URY Restaurant",
		"name": name,
		"company": company,
		"invoice_series_prefix": series_prefix,
		"branch": branch,
		"default_room": room.name,
		"active_menu": menu,
	}).insert(ignore_permissions=True)
	frappe.db.set_value("POS Profile", pos_profile, "restaurant", name)


def delete_restaurant(name):
	for doctype, docname in (("URY Restaurant", name), ("URY Room", f"{name} Room")):
		if frappe.db.exists(doctype, docname):
			frappe.delete_doc(doctype, docname, ignore_permissions=True, force=1)
