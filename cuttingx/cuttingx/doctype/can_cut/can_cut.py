# Copyright (c) 2025, Cognitonx Logic India Private limited and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import flt

class CanCut(Document):
    def before_save(self):
        # Auto-set status
        if self.docstatus == 0 and not self.status:
            self.status = 'Pending for Approval'

        # Auto-calculate fields
        self.calculate_fabric_balance()
        self.calculate_can_cut_quantity()
        self.calculate_can_cut_percent()

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

    frappe.msgprint(_('✅ Approved successfully.'), alert=True)

    # ✅ Force form reload
    frappe.local.response['reload'] = True    


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

    frappe.msgprint(_('❌ Rejected: {0}'.format(reason)), alert=True)
    
    # ✅ Force form reload
    frappe.local.response['reload'] = True    