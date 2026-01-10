# Copyright (c) 2025, Cognitonx Logic India Private limited and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import flt, get_url_to_form
import math 
from notificationx.api.whatsapp_api import send_whatsapp_template


class CanCut(Document):
    def before_save(self):
        if self.docstatus == 0 and not self.status:
            self.status = 'Pending for Approval'
        self.calculate_fabric_balance()
        self.calculate_can_cut_quantity()
        self.calculate_can_cut_percent()
        self.calculate_profit_loss_value() 

    def on_update(self):
        if self.docstatus == 1:
            return
        if self.status == 'Pending for Approval' and self._action == 'save':
            self.notify_approvers()
            # ✅ Enqueue ONLY after DB transaction is fully committed
            frappe.enqueue_doc(
                doctype=self.doctype,
                name=self.name,
                method="send_whatsapp_notification",
                queue="short",
                enqueue_after_commit=True  # ← THIS IS KEY
            )     

    def calculate_fabric_balance(self):
        self.fabric_balance = flt(self.fabric_issued) - flt(self.fabric_ordered)

    def calculate_can_cut_quantity(self):
        if flt(self.actual_consumption) > 0:
            self.can_cut_quantity = math.ceil(flt(self.fabric_issued) / flt(self.actual_consumption))
        else:
            self.can_cut_quantity = 0

    def calculate_can_cut_percent(self):
        if flt(self.order_quantity) > 0:
            self.can_cut_percent = (flt(self.can_cut_quantity) / flt(self.order_quantity)) * 100
        else:
            self.can_cut_percent = 0

    def calculate_profit_loss_value(self):
        qty_diff = flt(self.can_cut_quantity) - flt(self.order_quantity)
        fob_rate = flt(self.fob)
        self.profit_loss_value = qty_diff * (fob_rate * 0.7)

    def notify_approvers(self):
        # Get the merchant user linked in the document
        merchant_user = self.merchant
        if not merchant_user:
            frappe.log_error("Can Cut {self.name}: No merchant assigned for approval notification.")
            return

        # Fetch the merchant's email
        merchant_email = frappe.db.get_value("User", merchant_user, "email")
        if not merchant_email:
            frappe.log_error(f"Can Cut {self.name}: No email found for merchant user '{merchant_user}'.")
            return

        # Send email only to the merchant
        frappe.sendmail(
            recipients=[merchant_email],
            subject=f"📋 Action Required: Can Cut Approval Pending — {self.name}",
            message=f"""
                <p>A new <b>Can Cut</b> request is pending for your approval.</p>
                <p><b>Request ID:</b> {self.name}<br>
                <b>Style:</b> {self.style or '–'}<br>
                <b>Sales Order:</b> {self.sales_order or '–'}<br>
                <b>Requested By:</b> {self.owner}<br>
                <b>Can Cut %:</b> {self.can_cut_percent:.2f}%</p>
                <p><a href="{get_url_to_form('Can Cut', self.name)}" target="_blank">👉 Click to Review & Approve</a></p>
                <p><i>Note: You're receiving this because you're assigned as the merchant for this request.</i></p>
            """
        )

        # Optional: Send real-time notification to the merchant
        frappe.publish_realtime("msgprint", message=f"📋 New Can Cut pending approval: {self.name}", user=merchant_user)


    def notify_owner(self, action_by, status, reason=None):
        from frappe.utils import get_url_to_form
        owner_email = frappe.db.get_value("User", self.owner, "email")
        if not owner_email:
            return
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
        frappe.publish_realtime("msgprint", message=f"Can Cut {self.name} was {status.lower()} by {action_by}", user=self.owner)


    def send_whatsapp_notification(self):
        """
        Send WhatsApp approval notification using 'Can Cut Notification' config.
        Called from on_update or manually.
        """
        # Ensure we have a valid document name
        if not self.name:
            frappe.throw(_("Document not saved yet. Cannot send WhatsApp."))

        # Fetch WhatsApp notification config
        notif_name = "can_cut_approval_v3"
        try:
            notif_doc = frappe.get_doc("Whatsapp Notification", notif_name)
        except frappe.DoesNotExistError:
            frappe.log_error(
                title="WhatsApp Notification Missing",
                message=f"Can Cut {self.name}: Notification config '{notif_name}' not found."
            )
            return

        # Fetch style_group from Style Master
        style_group = "–"
        if self.style:
            if frappe.db.exists("Style Master", self.style):
                style_group = frappe.db.get_value("Style Master", self.style, "style_group") or "–"
            else:
                style_group = "⚠️ Style Missing"

        # Format to 1 decimal place (e.g., 95.5) or round to int if preferred
        can_cut_percent_str = f"{self.can_cut_percent:.1f}" if self.can_cut_percent else "0.0"   

        # Sanitize remarks for WhatsApp
        raw_remarks = self.requester_remarks or "–"
        # Replace line breaks with spaces and clean up
        sanitized_remarks = " ".join(raw_remarks.split()) if raw_remarks != "–" else "–"
        # Ensure max length (WhatsApp limit is 1024 chars per parameter)
        if sanitized_remarks != "–":
            sanitized_remarks = sanitized_remarks[:1024].rstrip(" .")  # Remove trailing spaces/periods

        # Prepare NAMED body parameters to match your template
        body_params = [
            {"name": "style", "value": self.style or "–"},
            {"name": "style_group", "value": style_group},
            {"name": "ocn", "value": self.sales_order or "–"},
            {"name": "color", "value": self.colour or "–"},
            {"name": "fabric_ordered", "value": str(int(self.fabric_ordered or 0))},
            {"name": "fabric_issued", "value": str(int(self.fabric_issued or 0))},
            {"name": "file_cons", "value": str(int(self.file_consumption or 0))},
            {"name": "file_dia", "value": str(int(self.file_dia or 0))},
            {"name": "file_gsm", "value": str(int(self.file_gsm or 0))},
            {"name": "file_lay", "value": str(int(self.file_lay_length or 0))},
            {"name": "actual_cons", "value": str(int(self.actual_consumption or 0))},
            {"name": "actual_dia", "value": str(int(self.actual_dia or 0))},
            {"name": "actual_gsm", "value": str(int(self.actual_gsm or 0))},
            {"name": "actual_lay", "value": str(int(self.actual_lay_length or 0))},
            {"name": "order_qty", "value": str(int(self.order_quantity or 0))},
            {"name": "can_cut_qty", "value": str(int(self.can_cut_quantity or 0))},
            {"name": "can_cut_percent", "value": can_cut_percent_str},
            {"name": "merchant", "value": self.merchant or "–"},
            {"name": "remarks", "value": sanitized_remarks or "–"},
        ]

        # Send to each recipient
        success_count = 0
        errors = []

        for recipient in notif_doc.whatsapp_recipients:
            if not recipient.whatsapp_number:
                continue
        
            result = send_whatsapp_template(
                to=recipient.whatsapp_number,
                template_name=notif_doc.template_name,
                body_params=body_params,
                button_params=[self.name]
            )

            if result["success"]:
                success_count += 1
                frappe.logger().info(
                    f"WhatsApp sent for Can Cut {self.name} to {recipient.whatsapp_number}: {result['message_id']}"
                )
            else:
                error_msg = result.get("error", "Unknown error")
                errors.append(f"{recipient.whatsapp_number}: {error_msg}")
                frappe.log_error(
                    title="Can Cut WhatsApp Failed",
                    message=(
                        f"Doc: {self.name}\n"
                        f"To: {recipient.whatsapp_number}\n"
                        f"Error: {error_msg}\n"
                        f"Template: {notif_doc.template_name}"
                    )
                )

        # Optional: Show user feedback (only if called interactively)
        if frappe.flags.in_api or frappe.flags.in_web_form:
            if errors:
                frappe.msgprint(
                    _("WhatsApp sent to {0} recipient(s). Errors: {1}").format(
                        success_count, "; ".join(errors)
                    ),
                    alert=True,
                    indicator="orange"
                )
            else:
                frappe.msgprint(
                    _("✅ WhatsApp notification sent to {0} recipient(s).").format(success_count),
                    alert=True,
                    indicator="green"
                )   


@frappe.whitelist()
def get_so_wo_from_cut_docket(cut_docket):
    if not cut_docket:
        return {"sales_orders": [], "work_orders_by_so": {}}

    # ✅ Restrict who can call this (adjust roles as needed)
    allowed_roles = {"Cutting User", "System Manager"}
    if not set(frappe.get_roles(frappe.session.user)).intersection(allowed_roles):
        frappe.throw(_("You do not have enough permissions to access this resource."))

    rows = frappe.get_all(
        "Cut Docket Item",
        filters={"parent": cut_docket, "parenttype": "Cut Docket"},
        fields=["sales_order", "ref_work_order"],
        limit_page_length=1000,
        ignore_permissions=True,
    )

    sales_orders = sorted({r.sales_order for r in rows if r.sales_order})
    work_orders_by_so = {}

    for r in rows:
        # ✅ FIX: use ref_work_order (not work_order)
        if r.sales_order and r.ref_work_order:
            work_orders_by_so.setdefault(r.sales_order, set()).add(r.ref_work_order)

    work_orders_by_so = {so: sorted(list(wos)) for so, wos in work_orders_by_so.items()}

    return {"sales_orders": sales_orders, "work_orders_by_so": work_orders_by_so}


@frappe.whitelist()
def get_auto_fill_data_from_work_order(work_order):
    if not work_order:
        return {}
    wo_doc = frappe.get_doc("Work Order", work_order)
    bom_no = wo_doc.bom_no
    production_item_code = wo_doc.production_item # Use the production item code

    if not production_item_code:
        frappe.throw(_("Work Order {0} does not have a Production Item specified.").format(work_order))
    if not bom_no:
        frappe.throw(_("Work Order {0} has no BOM.").format(work_order))
    try:
        bom = frappe.get_doc("BOM", bom_no)
    except frappe.DoesNotExistError:
        frappe.throw(_("BOM {0} not found").format(bom_no))
    fabric_items = [
        item for item in (bom.custom_fabrics_items or [])
        if item.custom_fg_link and item.custom_fg_link.strip().lower() == "cut main"
    ]
    if not fabric_items:
        frappe.msgprint(_("No fabric items found in BOM {0} with custom_fg_link='Cut Main'").format(bom_no))
        return {
            "fabric_ordered": 0,
            "file_consumption": 0,
            "file_gsm": 0,
            "file_fabric_width": 0,
            "file_dia": 0,
            "file_lay_length": 0 # Add default value for lay length
        }
    wo_line_items = wo_doc.get("custom_work_order_line_items") or []
    matched_qtys = []
    total_fabric = 0.0
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
    if total_fabric == 0:
        no_size_items = [item for item in fabric_items if not (item.custom_size or "").strip()]
        if len(no_size_items) == 1:
            qty_val = flt(no_size_items[0].qty)
            total_allocated = sum(flt(line.work_order_allocated_qty) for line in wo_line_items)
            total_fabric = qty_val * total_allocated
            matched_qtys = [qty_val]
    file_consumption = sum(matched_qtys) / len(matched_qtys) if matched_qtys else 0
    file_gsm = 0
    file_fabric_width = 0
    file_dia = 0
    file_lay_length = 0
    source_item_code = None
    if matched_qtys:
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
        if not source_item_code:
            fallback = next((item for item in fabric_items if item.item_code), None)
            if fallback:
                source_item_code = fallback.item_code

    # Fetch custom_lay_length from the production item
    if production_item_code:
        production_item_details = frappe.db.get_value("Item", production_item_code, ["custom_lay_length"], as_dict=True)
        if production_item_details:
            file_lay_length = flt(production_item_details.custom_lay_length or 0)

    # Fetch other fields (GSM, Width, Dia) from the source_item_code (as before)
    if source_item_code:
        item_details = frappe.db.get_value("Item", source_item_code, ["custom_gsm", "custom_width", "custom_dia"], as_dict=True)
        if item_details:
            file_gsm = flt(item_details.custom_gsm or 0)
            file_fabric_width = flt(item_details.custom_width or 0)
            file_dia = flt(item_details.custom_dia or 0)

    return {        
        "fabric_ordered": total_fabric,
        "file_consumption": file_consumption,
        "file_gsm": file_gsm,
        "file_fabric_width": file_fabric_width,
        "file_dia": file_dia,
        "file_lay_length": file_lay_length,
    }


@frappe.whitelist()
def approve(docname, approver_remarks=None, deviation_under=None):
    doc = frappe.get_doc("Can Cut", docname)
    if doc.status != 'Pending for Approval':
        frappe.throw(_('Only "Pending for Approval" documents can be approved'))
    if not frappe.db.exists("Has Role", {"parent": frappe.session.user, "role": "Can Cut Approver"}):
        frappe.throw(_("Only a Can Cut Approver can approve this document."))

    if approver_remarks is not None:
        doc.approver_remarks = approver_remarks
    if deviation_under is not None:
        doc.deviation_under = deviation_under

    can_cut_percent = flt(doc.can_cut_percent)

    if can_cut_percent >= 98:
        doc.status = 'Approved'
        doc.add_comment('Comment', text=f'Approved by {frappe.session.user}')

        # ✅ Final decision -> submit (docstatus = 1)
        doc.save(ignore_permissions=True)
        doc.flags.ignore_permissions = True
        if doc.docstatus == 0:
            doc.submit()

        action_by_name = frappe.db.get_value("User", frappe.session.user, "full_name")
        doc.notify_owner(action_by=action_by_name, status='Approved')
        frappe.msgprint(_('✅ Approved successfully.'), alert=True)

    else:
        doc.status = 'Pending Manager Approval'
        doc.add_comment(
            'Comment',
            text=f'Initial approval by {frappe.session.user}. Awaiting manager approval (Can Cut %: {can_cut_percent:.2f}%).'
        )

        # ✅ Not final -> DO NOT submit (keep docstatus = 0)
        doc.save(ignore_permissions=True)

        notify_managers_for_final_approval(doc)
        frappe.msgprint(_('✅ Initial approval granted. Sent to Can Cut Manager for final review.'), alert=True)


@frappe.whitelist()
def approve_by_manager(docname, manager_remarks=None, deviation_under=None):
    doc = frappe.get_doc("Can Cut", docname)
    if doc.status != 'Pending Manager Approval':
        frappe.throw(_('Only documents in "Pending Manager Approval" can be finally approved'))
    if not frappe.db.exists("Has Role", {"parent": frappe.session.user, "role": "Can Cut Manager"}):
        frappe.throw(_("Only a Can Cut Manager can perform final approval"))

    if manager_remarks is not None:
        doc.manager_remarks = manager_remarks
    if deviation_under is not None:
        doc.deviation_under = deviation_under

    doc.status = 'Approved'
    doc.add_comment('Comment', text=f'Final approval by {frappe.session.user}')

    # ✅ Final decision -> submit (docstatus = 1)
    doc.save(ignore_permissions=True)
    doc.flags.ignore_permissions = True
    if doc.docstatus == 0:
        doc.submit()

    action_by_name = frappe.db.get_value("User", frappe.session.user, "full_name")
    doc.notify_owner(action_by=action_by_name, status='Approved')
    frappe.msgprint(_('✅ Final approval granted. Can Cut approved.'), alert=True)


@frappe.whitelist()
def reject(docname, reason, deviation_under=None):
    doc = frappe.get_doc("Can Cut", docname)
    if doc.status not in ['Pending for Approval', 'Pending Manager Approval']:
        frappe.throw(_('Only pending documents can be rejected'))

    is_approver = frappe.db.exists("Has Role", {"parent": frappe.session.user, "role": "Can Cut Approver"})
    is_manager = frappe.db.exists("Has Role", {"parent": frappe.session.user, "role": "Can Cut Manager"})

    if not (is_approver or is_manager):
        frappe.throw(_("You don't have permission to reject this document"))

    if is_manager:
        doc.manager_remarks = reason
    else:
        doc.approver_remarks = reason

    if deviation_under is not None:
        doc.deviation_under = deviation_under

    doc.status = 'Rejected'
    comment = f'Rejected by {frappe.session.user}. Reason: {reason}'
    doc.add_comment('Comment', text=comment)
    doc.save(ignore_permissions=True)

    action_by_name = frappe.db.get_value("User", frappe.session.user, "full_name")
    doc.notify_owner(action_by=action_by_name, status='Rejected', reason=reason)
    frappe.msgprint(_('❌ Rejected: {0}').format(reason), alert=True)


def notify_managers_for_final_approval(doc):
    manager_user_ids = frappe.get_all("Has Role", filters={"role": "Can Cut Manager"}, pluck="parent")
    manager_user_ids = list(set(manager_user_ids))
    manager_user_ids = [u for u in manager_user_ids if u != frappe.session.user]
    manager_emails = [frappe.db.get_value("User", user_id, "email") for user_id in manager_user_ids]
    manager_emails = [email for email in manager_emails if email]
    if not manager_emails:
        return
    frappe.sendmail(
        recipients=manager_emails,
        subject=f"📋 Final Approval Required: Can Cut {doc.name} (<98%)",
        message=f"""
            <p>A Can Cut request requires your <b>final approval</b> because Can Cut % is <b>below 98%</b>.</p>
            <p><b>Request ID:</b> {doc.name}<br>
            <b>Style:</b> {doc.style or '–'}<br>
            <b>Sales Order:</b> {doc.sales_order or '–'}<br>
            <b>Requested By:</b> {doc.owner}<br>
            <b>Can Cut %:</b> {doc.can_cut_percent:.2f}%</p>
            <p><a href="{get_url_to_form('Can Cut', doc.name)}" target="_blank">👉 Click to Review & Approve</a></p>
            <p><i>Note: You're receiving this because you have the 'Can Cut Manager' role.</i></p>
        """
    )
    for user_id in manager_user_ids:
        frappe.publish_realtime(
            "msgprint",
            message=f"📋 Final Can Cut approval needed: {doc.name} ({doc.can_cut_percent:.2f}%)",
            user=user_id
        )