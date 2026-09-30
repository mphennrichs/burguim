import frappe


def execute():
	# Staff created through the Usuário screen before create_staff_user()
	# existed (ury.ury.api.users) were never linked to a Branch via the
	# `URY User` child table - ury_pos.api.getBranch() (every operational
	# screen's "which branch am I in" resolver) throws "User is not
	# Associated with any Branch" for any of them. Burguim is single-branch
	# (CONTEXT.md), so there's exactly one Branch to link them to; this
	# repairs any System User that isn't already linked to ANY branch,
	# rather than guessing who's affected.
	branch = frappe.db.get_value("Branch", {}, "name")
	if not branch:
		return

	already_linked = set(frappe.get_all("URY User", pluck="user"))

	orphaned_users = frappe.get_all(
		"User",
		filters={"user_type": "System User", "enabled": 1, "name": ["not in", ["Administrator", "Guest"]]},
		pluck="name",
	)

	branch_doc = frappe.get_doc("Branch", branch)
	changed = False
	for user in orphaned_users:
		if user in already_linked:
			continue
		branch_doc.append("user", {"user": user})
		changed = True

	if changed:
		branch_doc.save(ignore_permissions=True)
