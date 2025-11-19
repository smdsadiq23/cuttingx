# Copyright (c) 2025, Cognitonx Logic India Private limited and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import flt,  get_url_to_form
import math 


class CanCut(Document):
    def before_save(self):
        # Auto-set status
        if self.docstatus == 0 and not self.status:
            self.status = 'Pending for Approval'

        # Auto-calculate fields
        self.calculate_fabric_balance()
        self.calculate_can_cut_quantity()
        self.calculate_can_cut_percent()
        self.calculate_profit_loss_value() 


    def on_update(self):
        # Only run on save (not submit)
        if self.docstatus == 1:
            return

        # Send pending approval notification
        if self.status == 'Pending for Approval' and self._action == 'save':
            self.notify_approvers()        


    def calculate_fabric_balance(self):
        self.fabric_balance = flt(self.fabric_issued) - flt(self.fabric_ordered)


    def calculate_can_cut_quantity(self):
        # ✅ Use flt() to handle None
        if flt(self.actual_consumption) > 0:
            self.can_cut_quantity = math.ceil(flt(self.fabric_issued) / (flt(self.actual_consumption)))
        else:
            self.can_cut_quantity = 0


    def calculate_can_cut_percent(self):
        if flt(self.order_quantity) > 0:
            self.can_cut_percent = (flt(self.can_cut_quantity) / flt(self.order_quantity)) * 100
        else:
            self.can_cut_percent = 0

    def calculate_profit_loss_value(self):
        qty_diff = flt(self.can_cut_quantity) - flt(self.order_quantity)
        fob_rate = flt(self.fob)  # Now comes from Can Cut's own field
        self.profit_loss_value = qty_diff * (fob_rate * 0.7)

    def notify_approvers(self):
        """Notify all Can Cut Approvers that approval is pending."""
        from frappe.utils import get_url_to_form

        # Get user IDs with "Can Cut Approver" role
        approver_user_ids = frappe.get_all(
            "Has Role",
            filters={"role": "Can Cut Approver"},
            pluck="parent"  # returns list of user IDs (e.g., "Administrator", "user1")
        )
        approver_user_ids = list(set(approver_user_ids))  # deduplicate

        # Remove current user (optional, but cleaner)
        approver_user_ids = [u for u in approver_user_ids if u != frappe.session.user]

        # ✅ Convert user IDs to email addresses for email
        approver_emails = [
            frappe.db.get_value("User", user_id, "email")
            for user_id in approver_user_ids
        ]
        approver_emails = [email for email in approver_emails if email]

        if not approver_emails:
            return

        # Email (to valid emails)
        frappe.sendmail(
            recipients=approver_emails,
            subject=f"📋 Action Required: Can Cut Approval Pending — {self.name}",
            message=f"""
                <p>A new <b>Can Cut</b> request is pending your approval.</p>
                <p><b>Request ID:</b> {self.name}<br>
                <b>Style:</b> {self.style or '–'}<br>
                <b>Sales Order:</b> {self.sales_order or '–'}<br>
                <b>Requested By:</b> {self.owner}<br>
                <b>Can Cut %:</b> {self.can_cut_percent:.2f}%</p>
                <p><a href="{get_url_to_form('Can Cut', self.name)}" target="_blank">👉 Click to Review & Approve</a></p>
                <p><i>Note: You're receiving this because you have the 'Can Cut Approver' role.</i></p>
            """
        )

        # Desktop Notification (still uses user IDs)
        for user_id in approver_user_ids:
            frappe.publish_realtime(
                "msgprint",
                message=f"📋 New Can Cut pending approval: {self.name}",
                user=user_id
            )


    def notify_owner(self, action_by, status, reason=None):
        """
        Notify the owner (creator) when approved or rejected.
        :param action_by: User who approved/rejected
        :param status: 'Approved' or 'Rejected'
        :param reason: Rejection reason (if any)
        """
        from frappe.utils import get_url_to_form

        # ✅ Resolve owner user ID to email
        owner_email = frappe.db.get_value("User", self.owner, "email")
        if not owner_email:
            # Optional: log or skip
            return

        # Email
        frappe.sendmail(
            recipients=[owner_email],
            subject=f"Can Cut {status}: {self.name}",
            message=f"""
                <p>Your <b>Can Cut</b> request <b>{self.name}</b> has been <b>{status}</b>.</p>
                <p><b>Style:</b> {self.style or '–'}<br>
                <b>Sales Order:</b> {self.sales_order or '–'}<br>
                <b>Can Cut %:</b> {self.can_cut_percent:.2f}%</p>
                {f'<p><b>Reason:</b> {reason}</p>' if reason else ''}
                <p><b>Action by:</b> {action_by}</p>
                <p><a href="{get_url_to_form('Can Cut', self.name)}" target="_blank">View Request</a></p>
            """
        )

        # Desktop Notification (uses user ID — correct as-is)
        frappe.publish_realtime(
            "msgprint",
            message=f"Can Cut {self.name} was {status.lower()} by {action_by}",
            user=self.owner
        )


@frappe.whitelist()
def get_auto_fill_data_from_work_order(work_order):
    if not work_order:
        return {}

    wo_doc = frappe.get_doc("Work Order", work_order)
    bom_no = wo_doc.bom_no
    if not bom_no:
        frappe.throw(_("Work Order {0} has no BOM.").format(work_order))

    try:
        bom = frappe.get_doc("BOM", bom_no)
    except frappe.DoesNotExistError:
        frappe.throw(_("BOM {0} not found").format(bom_no))

    fabric_items = [
        item for item in (bom.custom_fabrics_items or [])
        if item.custom_fg_link == "Cut Main"
    ]

    if not fabric_items:
        frappe.msgprint(_("No fabric items found in BOM {0} with custom_fg_link='Cut Main'").format(bom_no))
        return {
            "fabric_ordered": 0,
            "file_consumption": 0,
            "file_gsm": 0,
            "file_fabric_width": 0
        }

    wo_line_items = wo_doc.get("custom_work_order_line_items") or []
    matched_qtys = []  # ← Collect qtys of ACTUALLY MATCHED BOM items
    total_fabric = 0.0

    # === Primary: size-by-size match ===
    for line in wo_line_items:
        size = (line.size or "").strip().lower()
        allocated_qty = flt(line.work_order_allocated_qty)
        if not size or allocated_qty <= 0:
            continue

        matched_item = next(
            (item for item in fabric_items if (item.custom_size or "").strip().lower() == size),
            None
        )
        if matched_item:
            qty_val = flt(matched_item.qty)
            total_fabric += qty_val * allocated_qty
            matched_qtys.append(qty_val)

    # === Fallback: no size match → use single no-size item ===
    if total_fabric == 0:
        no_size_items = [item for item in fabric_items if not (item.custom_size or "").strip()]
        if len(no_size_items) == 1:
            qty_val = flt(no_size_items[0].qty)
            total_allocated = sum(flt(line.work_order_allocated_qty) for line in wo_line_items)
            total_fabric = qty_val * total_allocated
            # For consumption, we use this single qty (not averaged)
            matched_qtys = [qty_val]

    # === file_consumption = average of matched qtys ===
    file_consumption = sum(matched_qtys) / len(matched_qtys) if matched_qtys else 0

    # === Get GSM & Width from first matched fabric item's Item doc ===
    file_gsm = 0
    file_fabric_width = 0

    # Try to get item_code from first matched BOM item
    source_item_code = None
    if matched_qtys:
        # Reuse matching logic to get the first matched item
        for line in wo_line_items:
            size = (line.size or "").strip().lower()
            if not size or flt(line.work_order_allocated_qty) <= 0:
                continue
            matched = next(
                (item for item in fabric_items if (item.custom_size or "").strip().lower() == size),
                None
            )
            if matched and matched.item_code:
                source_item_code = matched.item_code
                break
        # Fallback: use first no-size or first fabric item
        if not source_item_code:
            fallback = next((item for item in fabric_items if item.item_code), None)
            if fallback:
                source_item_code = fallback.item_code

    if source_item_code:
        item = frappe.db.get_value(
            "Item",
            source_item_code,
            ["custom_gsm", "custom_width", "custom_dia"],
            as_dict=True
        )
        # frappe.msgprint(item.name)
        if item:
            file_gsm = flt(item.custom_gsm or 0)
            file_fabric_width = flt(item.custom_width or 0)
            file_dia = flt(item.custom_dia or 0)


    return {
        "fabric_ordered": total_fabric,
        "file_consumption": file_consumption,
        "file_gsm": file_gsm,
        "file_fabric_width": file_fabric_width,
        "file_dia": file_dia
    }


# ✅ Whitelisted Methods (Top-Level)
@frappe.whitelist()
def approve(docname):
    """Approve the Can Cut"""
    doc = frappe.get_doc("Can Cut", docname)

    if doc.status != 'Pending for Approval':
        frappe.throw(_('Only "Pending for Approval" documents can be approved'))

    # Check role
    if not frappe.db.exists("Has Role", {
        "parent": frappe.session.user,
        "parenttype": "User",
        "role": "Can Cut Approver"
    }):
        frappe.throw(_("You don't have permission to approve this document"))

    doc.status = 'Approved'
    doc.add_comment('Comment', text='Approved by {}'.format(frappe.session.user))
    doc.save()

    # Get approver's full name
    action_by_name = frappe.db.get_value("User", frappe.session.user, "full_name")

    # ✅ Notify owner
    doc.notify_owner(action_by=action_by_name, status='Approved')  

    frappe.msgprint(_('✅ Approved successfully.'), alert=True)
   

@frappe.whitelist()
def reject(docname, reason=None):
    """Reject the Can Cut"""
    doc = frappe.get_doc("Can Cut", docname)

    if doc.status != 'Pending for Approval':
        frappe.throw(_('Only "Pending for Approval" documents can be rejected'))

    # Check role
    if not frappe.db.exists("Has Role", {
        "parent": frappe.session.user,
        "parenttype": "User",
        "role": "Can Cut Approver"
    }):
        frappe.throw(_("You don't have permission to reject this document"))

    doc.status = 'Rejected'
    comment = f'Rejected by {frappe.session.user}. Reason: {reason}'
    doc.add_comment('Comment', text=comment)
    doc.save()

    # Get approver's full name
    action_by_name = frappe.db.get_value("User", frappe.session.user, "full_name")

    # ✅ Notify owner
    doc.notify_owner(action_by=action_by_name, status='Rejected', reason=reason)

    frappe.msgprint(_('❌ Rejected: {0}'.format(reason)), alert=True)  