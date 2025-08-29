# Copyright (c) 2025, Cognitonx Logic India Private limited and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import flt,  get_url_to_form


class CanCut(Document):
    def before_save(self):
        # Auto-set status
        if self.docstatus == 0 and not self.status:
            self.status = 'Pending for Approval'

        # Auto-calculate fields
        self.calculate_fabric_balance()
        self.calculate_can_cut_quantity()
        self.calculate_can_cut_percent()


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
            self.can_cut_quantity = flt(self.fabric_issued) / (flt(self.actual_consumption))
        else:
            self.can_cut_quantity = 0


    def calculate_can_cut_percent(self):
        if flt(self.order_quantity) > 0:
            self.can_cut_percent = (flt(self.can_cut_quantity) / flt(self.order_quantity)) * 100
        else:
            self.can_cut_percent = 0


    def notify_approvers(self):
        """Notify all Can Cut Approvers that approval is pending."""
        # Get all users with "Can Cut Approver" role
        approvers = frappe.get_all(
            "Has Role",
            filters={"role": "Can Cut Approver"},
            pluck="parent"  # returns list of user emails
        )
        approvers = list(set(approvers))  # deduplicate

        # Email
        frappe.sendmail(
            recipients=approvers,
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

        # Desktop Notification
        for user in approvers:
            frappe.publish_realtime(
                "msgprint",
                message=f"📋 New Can Cut pending approval: {self.name}",
                user=user
            )


    def notify_owner(self, action_by, status, reason=None):
        """
        Notify the owner (creator) when approved or rejected.
        :param action_by: User who approved/rejected
        :param status: 'Approved' or 'Rejected'
        :param reason: Rejection reason (if any)
        """
        # Email
        frappe.sendmail(
            recipients=[self.owner],
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

        # Desktop Notification
        frappe.publish_realtime(
            "msgprint",
            message=f"Can Cut {self.name} was {status.lower()} by {action_by}",
            user=self.owner
        )


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