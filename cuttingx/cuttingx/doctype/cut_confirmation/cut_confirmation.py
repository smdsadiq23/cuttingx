# Copyright (c) 2025, CognitionX Logic India Private limited and contributors
# For license information, please see license.txt

# import frappe
import frappe
from frappe import _
from frappe.model.document import Document


class CutConfirmation(Document):
    pass


def validate(doc, method):
    """
    Called on validate of Cut Confirmation
    Recalculate all child rows
    """
    for item in doc.table_cut_confirmation_item:
        item.calculate_balance_to_confirm()  # Calls method from child class
        item.calculate_total_reject()  # Calls method from child class


@frappe.whitelist()
def get_items_from_cut_docket(cut_po_number):
    """
    Fetch data from Cut Docket Item child table based on given docket number.
    Returns: List of dicts with fields for Cut Confirmation Item.
    """
    if not cut_po_number:
        return []

    try:
        docket_doc = frappe.get_doc("Cut Docket", cut_po_number)
    except frappe.DoesNotExistError:
        frappe.throw(_("Cut Docket {0} not found").format(cut_po_number))

    items = []
    for item in docket_doc.get("table_size_ratio_qty") or []:
        if item.ref_work_order and item.size:
            items.append({
                "work_order": item.ref_work_order,
                "size": item.size,
                "planned_quantity": item.planned_cut_quantity
            })

    return items


@frappe.whitelist()
def get_sales_orders_from_docket(docket_name):
    """
    Return list of unique sales orders from Cut Docket -> Cut Docket SO Details table
    """
    if not docket_name:
        return []

    docket = frappe.get_doc("Cut Docket", docket_name)
    sales_orders = set()

    for row in docket.sale_order_details:
        if row.sales_order:
            sales_orders.add(row.sales_order)

    return list(sales_orders)

