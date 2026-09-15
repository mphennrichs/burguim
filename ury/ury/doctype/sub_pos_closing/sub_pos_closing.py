
import frappe
from frappe import _
from frappe.utils import flt, get_datetime
from datetime import datetime, timedelta
from frappe.model.document import Document
import json
import requests
from datetime import datetime
from ury.ury_pos.api import getBranch
from frappe.utils import  get_datetime,now


class SubPOSClosing(Document):
    def validate(self):
        owner = None
        branch = frappe.db.get_value("POS Profile", self.pos_profile, "branch")

        draft_invoices = frappe.get_all(
            "POS Invoice",
            fields=["name"],
            filters={"branch": branch, "status": "Draft", "docstatus": "0","cashier":self.user},
        )
        if draft_invoices:
            frappe.throw("Submit/Delete Draft Invoices")

        date_time = now()
        if isinstance(date_time, str):
            formatted_date_time = date_time.split('.')[0]
        else:
            formatted_date_time = date_time.strftime('%Y-%m-%d %H:%M:%S')
        self.period_end_date = date_time

        time_part = formatted_date_time.split(' ')[1]
        self.posting_time = time_part
        
        invoices = frappe.get_all(
            "POS Invoice",
            filters={
                "docstatus": 1,
                "status":"Paid",
                "posting_date": ["between", [self.period_start_date, self.period_end_date]],
                "cashier":self.user
            },
            fields=["name", "posting_date", "customer", "grand_total", "base_grand_total"]
        )
        
        self.set("pos_transactions", [])
        
        for invoice in invoices:
            self.append("pos_transactions", {
                "pos_invoice": invoice.name,
                "posting_date": invoice.posting_date,
                "customer": invoice.customer,
                "grand_total": invoice.grand_total,
                "base_grand_total": invoice.base_grand_total
            })

        multiple_cashier = frappe.db.get_value("POS Profile", self.pos_profile, "custom_enable_multiple_cashier")
        if multiple_cashier:
            get_cashier = frappe.get_doc("POS Profile", self.pos_profile)
            for user_details in get_cashier.applicable_for_users:
                if user_details.custom_main_cashier:
                    owner = user_details.user
            if frappe.session.user == owner:
                frappe.throw("The Main Cashier cannot close a Sub POS Closing entry.")
        else:
            pass
    
    def on_submit(self):
        opening_entry = frappe.get_doc("POS Opening Entry", self.pos_opening_entry)
        opening_entry.custom_sub_pos_close_entry = self.name
        opening_entry.status = "Closed"
        opening_entry.save()
    
    def on_cancel(self):
        opening_entry = frappe.get_doc("POS Opening Entry", self.pos_opening_entry)
        opening_entry.custom_sub_pos_close_entry = self.name
        opening_entry.status = "Open"
        opening_entry.save()


@frappe.whitelist()
def get_pos_profile():
    branch = getBranch()
    pos_profile = frappe.db.get_value("POS Profile", {"branch": branch}, "name")
    return pos_profile


def _extract_parent_filter(filters):
    """Best-effort read of a `parent` condition out of `filters`, which
    (being a standard Frappe search-field argument) could legitimately be
    either a plain dict or a list of [field, operator, value] conditions —
    only used to figure out which POS Profile is being asked about for the
    branch check below; never mutates or replaces the value actually
    passed on to frappe.get_all."""
    if isinstance(filters, str):
        try:
            filters = frappe.parse_json(filters)
        except Exception:
            return None
    if isinstance(filters, dict):
        return filters.get("parent")
    if isinstance(filters, (list, tuple)):
        for cond in filters:
            if isinstance(cond, (list, tuple)) and len(cond) >= 1 and cond[0] == "parent":
                return cond[-1]
    return None


@frappe.whitelist()
@frappe.validate_and_sanitize_search_inputs
def get_cashiers(doctype, txt, searchfield, start, page_len, filters):
    # `filters` comes straight from the client (it's a standard Frappe
    # search-field callback) and was passed unchecked into frappe.get_all,
    # which ignores permissions — a caller could ask for cashiers on a POS
    # Profile belonging to any branch, not just their own. Reusing
    # get_pos_invoices' own branch-scoping pattern just below.
    profile = _extract_parent_filter(filters)
    if profile:
        session_user = frappe.session.user
        is_supervisor = session_user == "Administrator" or bool(
            set(frappe.get_roles(session_user)) & SUPERVISOR_ROLES
        )
        if not is_supervisor:
            try:
                session_branch = getBranch()
            except Exception:
                session_branch = None
            profile_branch = frappe.db.get_value("POS Profile", profile, "branch")
            if not session_branch or profile_branch != session_branch:
                frappe.throw(
                    _("You do not have permission to access cashiers for POS Profile {0}.").format(profile),
                    frappe.PermissionError,
                )

    cashiers_list = frappe.get_all(
        "POS Profile User", filters=filters, fields=["user"], as_list=1
    )
    return [c for c in cashiers_list]


SUPERVISOR_ROLES = {"URY Manager", "System Manager"}


@frappe.whitelist()
def get_pos_invoices(start, end, pos_profile, user):
    frappe.has_permission("POS Invoice", "read", throw=True)

    session_user = frappe.session.user
    is_supervisor = session_user == "Administrator" or bool(
        set(frappe.get_roles(session_user)) & SUPERVISOR_ROLES
    )

    # Non-supervisors may only query their own invoices
    if not is_supervisor:
        user = session_user

    # Branch scoping: the POS Profile must belong to the session user's branch
    try:
        session_branch = getBranch()
    except Exception:
        if is_supervisor:
            # Supervisors may not be mapped to a branch
            session_branch = None
        else:
            raise

    profile_branch = frappe.db.get_value(
        "POS Profile", pos_profile, "branch"
    )

    if not profile_branch:
        frappe.throw(
            _("POS Profile {0} not found.").format(pos_profile),
            frappe.DoesNotExistError,
        )

    if session_branch and profile_branch != session_branch:
        frappe.throw(
            _("You do not have permission to access invoices for POS Profile {0}.").format(
                pos_profile
            ),
            frappe.PermissionError,
        )

    data = frappe.db.sql(
        """
        select
            name, timestamp(posting_date, posting_time) as "timestamp"
        from
            `tabPOS Invoice`
        where
            cashier = %s and docstatus = 1 and pos_profile = %s and ifnull(consolidated_invoice,'') = '' and status != "Consolidated"
        """,
        (user, pos_profile),
        as_dict=1,
    )

    data = list(
        filter(
            lambda d: get_datetime(start)
            <= get_datetime(d.timestamp)
            <= get_datetime(end),
            data,
        )
    )
    # need to get taxes and payments so can't avoid get_doc
    data = [frappe.get_doc("POS Invoice", d.name).as_dict() for d in data]

    return data