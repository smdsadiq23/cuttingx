# Copyright (c) 2025, Cognitonx Logic India Private limited and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from labelx.utils.generators import generate_barcode_base64, generate_qrcode_base64
from frappe.model.naming import make_autoname


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


# @frappe.whitelist()
# def get_sales_and_work_orders_from_docket(cut_docket_id):
#     if not cut_docket_id:
#         return {"sales_orders": [], "work_orders": []}

#     try:
#         docket = frappe.get_doc("Cut Docket", cut_docket_id)
#     except frappe.DoesNotExistError:
#         return {"sales_orders": [], "work_orders": []}

#     sales_orders = set()
#     work_orders = set()

#     for row in docket.get("sale_order_details", []):
#         if row.sales_order:
#             sales_orders.add(row.sales_order)

#     for row in docket.get("work_order_details", []):
#         if row.work_order:
#             work_orders.add(row.work_order)

#     return {
#         "sales_orders": list(sales_orders),
#         "work_orders": list(work_orders)
#     }


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
        fields=['work_order', 'sales_order', 'line_item_no', 'size', 'confirmed_quantity']
    )

    # Return data in desired structure
    return [
        {
            'work_order': item['work_order'],
            'sales_order': item['sales_order'],
            'line_item_no': item['line_item_no'],
            'size': item['size'],
            'cut_quantity': item['confirmed_quantity']
        }
        for item in items
    ]


@frappe.whitelist()
def generate_bundle_details(docname):
    """
    Generate bundle rows with barcode/QR for a given Bundle Creation document.
    Includes: bundle_id, unitsbundle, size, barcode, QR
    Validates unitsbundle > 0 per row.
    Avoids duplicates if already generated.
    """
    doc = frappe.get_doc("Bundle Creation", docname)

    # 🚫 Don't regenerate if bundles already exist
    if doc.get("table_bundle_details"):
        frappe.msgprint("⚠️ Bundles already created. Please remove existing bundles to regenerate.")
        return

    # 🔍 Get naming series from 'bundle_id' field in 'Bundle Details'
    bundle_id_field = frappe.get_meta("Bundle Details").get_field("bundle_id")
    default_series = bundle_id_field.options or "BNDL.#####"

    # ✅ Validate all rows before creating any bundles
    for item in doc.table_bundle_creation_item:
        planned_quantity = item.planned_quantity or 0
        unitsbundle = item.unitsbundle

        # Use int() safely with validation
        try:
            total_qty = int(planned_quantity)
        except (ValueError, TypeError):
            frappe.throw(f"Invalid Planned Quantity in row {item.idx}: must be a number")

        try:
            units_per_bundle = int(unitsbundle) if unitsbundle is not None else 0
        except (ValueError, TypeError):
            frappe.throw(f"Invalid Units per Bundle in row {item.idx}: must be a number")

        if units_per_bundle <= 0:
            frappe.throw(f"Units per bundle must be greater than 0 in row {item.idx}")

    # ✅ All valid — now generate bundles
    for item in doc.table_bundle_creation_item:
        total_qty = int(item.planned_quantity or 0)
        units_per_bundle = int(item.unitsbundle)  # Already validated above
        size = item.size  # ✅ Fetch size from Bundle Creation Item

        # Ceiling division: total_bundles = ceil(total_qty / units_per_bundle)
        total_bundles = (total_qty + units_per_bundle - 1) // units_per_bundle

        for i in range(total_bundles):
            # Calculate quantity for this bundle
            if i == total_bundles - 1:
                bundle_qty = total_qty - units_per_bundle * (total_bundles - 1)
            else:
                bundle_qty = units_per_bundle

            # Generate bundle ID and codes
            bundle_id = make_autoname(default_series)
            barcode_b64 = generate_barcode_base64(bundle_id)
            qrcode_b64 = generate_qrcode_base64(bundle_id)

            # Append to child table
            doc.append("table_bundle_details", {
                "bundle_id": bundle_id,
                "unitsbundle": bundle_qty,
                "size": size,  # ✅ Add size
                "barcode_image": barcode_b64,
                "qrcode_image": qrcode_b64,
                "parent_item_id": item.name 
            })

    # Save and notify
    doc.save(ignore_permissions=True)
    frappe.msgprint(f"✅ Created {len(doc.table_bundle_details)} bundles with QR, Barcode, and Size.")