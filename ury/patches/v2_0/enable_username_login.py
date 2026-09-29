import frappe


def execute():
	# Staff can now set a "Nome de usuário" (User.username) when creating an
	# account (frontend/src/pages/Dashboard/UserPage.tsx) - but Frappe's own
	# login form only accepts that as a valid login id when this System
	# Settings toggle is on. Without it, typing a username (not an e-mail)
	# at login fails with a generic "Invalid Login", even though the field
	# is set correctly on the User record. Confirmed live.
	frappe.db.set_single_value("System Settings", "allow_login_using_user_name", 1)
