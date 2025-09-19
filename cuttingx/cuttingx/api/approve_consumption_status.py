
import frappe
from frappe import _
from frappe.utils import now_datetime


@frappe.whitelist()
def approve_consumption_status(sales_order):
    """
    Called from Report JS to approve status + capture metadata
    """
    doc = frappe.get_doc("Sales Order", sales_order)

    # Check permission
    if not doc.has_permission("write"):
        frappe.throw(_("Not permitted"), frappe.PermissionError)

    # Validate role
    if not frappe.session.user == "Administrator" and not frappe.db.exists("Has Role", {
        "parent": frappe.session.user,
        "role": "Factory Manager"
    }):
        frappe.throw(_("Only Factory Manager can approve"))

    # Validate required fields in Can Cut
    missing_fields = validate_cutting_completion(sales_order)
    if missing_fields:
        frappe.throw(
            _("Cannot approve. Missing data: {0}").format(", ".join(missing_fields)),
            title=_("Incomplete Cutting Process")
        )

    # Update all fields
    doc.custom_consumption_status = "Approved"
    doc.custom_approved_by = frappe.session.user
    doc.custom_approved_on = now_datetime()

    # Save with ignore_permissions=False (respects DocType rules)
    doc.save(ignore_permissions=True)  # Since we already checked
    frappe.db.commit()

    return {"message": "Approved successfully"}


def validate_cutting_completion(sales_order):
    """
    Returns list of missing required fields across all colours
    """
    required_fields = [
        "fabric_ordered",
        "fabric_issued",
        "folding",
        "end_bit",
        "file_consumption",
        "actual_consumption"
    ]

    result = frappe.db.sql("""
        SELECT 
            cc.fabric_ordered,
            cc.fabric_issued,
            cc.folding,
            cc.end_bit,
            cc.file_consumption,
            cc.actual_consumption
        FROM `tabCan Cut` cc
        WHERE cc.sales_order = %s
    """, sales_order, as_dict=1)

    missing = []
    for row in result:
        for f in required_fields:
            val = row.get(f)
            if not val or str(val).strip() == "":
                label = " ".join([word.capitalize() for word in f.split("_")])
                if label not in missing:
                    missing.append(label)

    return missing