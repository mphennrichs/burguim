import frappe
from frappe.utils import today

@frappe.whitelist()
def get_dashboard_summary(branch=None):
    filters = {}
    if branch and branch != 'all':
        pass

    return {
        "today_sales": 0,
        "today_orders": 0,
        "avg_order_value": 0,
        "active_cashiers": frappe.db.count("User", {"enabled": 1}),
        "total_menu_items": frappe.db.count("Item") if frappe.db.exists("DocType", "Item") else 0,
    }

@frappe.whitelist()
def get_dashboard_charts(branch=None):
    return {
        "sales_trend": [],
        "hourly_sales": [],
        "payment_methods": [],
        "order_types": [],
        "top_items": [],
        "revenue_by_branch": [],
        "sales_by_course": [],
    }

@frappe.whitelist()
def get_recent_transactions(branch=None, limit=10):
    filters = {"docstatus": ["in", [0, 1]]}
    if branch and branch != 'all':
        pass # Add branch filter if applicable for POS Invoice, usually 'custom_branch' or 'branch'
    
    if frappe.db.exists("DocType", "POS Invoice"):
        try:
            invoices = frappe.get_all("POS Invoice", 
                filters=filters,
                fields=["name", "customer", "posting_date", "posting_time", "grand_total", "status", "order_type", "restaurant_table as restaurant_table", "owner as cashier"],
                order_by="creation desc",
                limit=int(limit)
            )
            for inv in invoices:
                if not inv.get("status"):
                    inv["status"] = "Draft" if inv.get("docstatus") == 0 else "Paid"
                if not inv.get("order_type"):
                    inv["order_type"] = "Take Away"
            return invoices
        except Exception as e:
            # frappe.log_error's real signature is (title, message) — an
            # unbounded exception string must go in `message`, never bare
            # as `title`, or log_error itself can throw
            # CharacterLengthExceededError (Error Log's title field caps
            # at 140 chars).
            frappe.log_error(title="get_recent_transactions", message=f"Error in get_recent_transactions: {str(e)}")
            return []
    return []

# get_module_records used to take `doctype` straight from the client and
# hand it to frappe.get_all(..., fields=["*"]) — frappe.get_all skips
# permission checks entirely (unlike get_list), so this bypassed every
# doctype permission and every branch-isolation hook in ury/permission.py
# in one shot, for ANY doctype in the system, to ANY authenticated user
# regardless of role. Confirmed exploitable end-to-end during a security
# review: a Cashier account could dump the full User table (every field,
# no allowlist) and URY Self Ordering Profile's qr_signing_secret in
# plaintext — then use that secret to forge a valid QR/delivery token and
# open a real guest ordering session that was never actually issued.
#
# Fixed by restricting `doctype` to exactly what the admin frontend's
# generic list screens actually ask for (grep frontend/src for every
# getModuleRecords call site), and by never returning fields=["*"] for a
# doctype that can hold anything sensitive — today just User, restricted
# to a safe display-only field list matching what UserPage.tsx actually
# reads.
ALLOWED_MODULE_DOCTYPES = {
    "Branch",
    "Item",
    "Item Group",
    "URY Menu",
    "URY Menu Course",
    "URY Production Unit",
    "URY Room",
    "User",
}

SAFE_FIELDS_BY_DOCTYPE = {
    "User": ["name", "email", "first_name", "last_name", "full_name", "user_type", "enabled"],
}


@frappe.whitelist()
def get_module_records(doctype, branch=None):
    if doctype not in ALLOWED_MODULE_DOCTYPES or not frappe.db.exists("DocType", doctype):
        return []

    filters = {}
    if branch and branch != 'all':
        meta = frappe.get_meta(doctype)
        if meta.has_field("branch"):
            filters["branch"] = branch
        elif meta.has_field("custom_branch"):
            filters["custom_branch"] = branch

    fields = SAFE_FIELDS_BY_DOCTYPE.get(doctype, ["*"])

    try:
        records = frappe.get_all(doctype, filters=filters, fields=fields)
        if doctype == "User":
            for r in records:
                r["roles"] = frappe.get_all("Has Role", filters={"parent": r.name}, fields=["role"])
        return records
    except Exception:
        return []
