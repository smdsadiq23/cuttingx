# Copyright (c) 2025, Cognitonx Logic India Private limited and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class BundleCreation(Document):
	pass


@frappe.whitelist()
def get_eligible_cut_dockets():
    # Step 1: Get all Cut Dockets used in submitted Bundle Creation
    used_in_bundle = frappe.get_all(
        'Bundle Creation',
        filters={'docstatus': 1},
        fields=['cut_docket_id']
    )
    used_docket_ids = {d['cut_docket_id'] for d in used_in_bundle if d['cut_docket_id']}

    # Step 2: Get all Cut Dockets used in submitted Cut Confirmation
    submitted_cut_confirmations = frappe.get_all(
        'Cut Confirmation',
        filters={'docstatus': 1},
        fields=['cut_po_number']
    )
    eligible = [
        d['cut_po_number'] for d in submitted_cut_confirmations
        if d['cut_po_number'] not in used_docket_ids
    ]

    return eligible


@frappe.whitelist()
def get_sales_and_work_orders_from_docket(cut_docket_id):
    if not cut_docket_id:
        return {"sales_orders": [], "work_orders": []}

    try:
        docket = frappe.get_doc("Cut Docket", cut_docket_id)
    except frappe.DoesNotExistError:
        return {"sales_orders": [], "work_orders": []}

    sales_orders = set()
    work_orders = set()

    for row in docket.get("sale_order_details", []):
        if row.sales_order:
            sales_orders.add(row.sales_order)

    for row in docket.get("work_order_details", []):
        if row.work_order:
            work_orders.add(row.work_order)

    return {
        "sales_orders": list(sales_orders),
        "work_orders": list(work_orders)
    }

import frappe


@frappe.whitelist()
def get_cut_confirmation_items_from_docket(cut_docket_id):
    """Fetch size and confirmed_quantity from Cut Confirmation Item for the given Cut PO"""
    if not cut_docket_id:
        return []

    confirmation = frappe.get_all(
        'Cut Confirmation',
        filters={'cut_po_number': cut_docket_id, 'docstatus': 1},
        fields=['name']
    )

    if not confirmation:
        return []

    confirmation_name = confirmation[0]['name']

    items = frappe.get_all(
        'Cut Confirmation Item',
        filters={'parent': confirmation_name},
        fields=['size', 'confirmed_quantity']
    )

    # Return data in desired structure
    return [
        {
            'size': item['size'],
            'cut_quantity': item['confirmed_quantity']
        }
        for item in items
    ]

