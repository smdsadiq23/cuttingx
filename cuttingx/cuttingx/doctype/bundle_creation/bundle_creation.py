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
    Bundle ID now uses a per-Work-Order series, e.g., BNDL-WO-0001-00001, and
    continues across documents/cut dockets for the same Work Order.
    """
    import re
    doc = frappe.get_doc("Bundle Creation", docname)

    # 🚫 Don't regenerate if bundles already exist
    if doc.get("table_bundle_details"):
        frappe.msgprint("⚠️ Bundles already created. Please remove existing bundles to regenerate.")
        return

    # Original default (fallback) from child field options or a sensible default
    bundle_id_field = frappe.get_meta("Bundle Details").get_field("bundle_id")
    default_series = (bundle_id_field.options or "BNDL.#####").replace(".", "-.")  # normalize to BNDL-.#####

    # ✅ Validate all rows before creating any bundles
    for item in doc.table_bundle_creation_item:
        # try:
        #     total_qty = int(item.planned_quantity or 0)
        # except (ValueError, TypeError):
        #     frappe.throw(f"Invalid Planned Quantity in row {item.idx}: must be a number")

        try:
            units_per_bundle = int(item.unitsbundle) if item.unitsbundle is not None else 0
        except (ValueError, TypeError):
            frappe.throw(f"Invalid Units per Bundle in row {item.idx}: must be a number")

        if units_per_bundle <= 0:
            frappe.throw(f"Units per bundle must be greater than 0 in row {item.idx}")

        # optional: skip rows with 0 total
        # if total_qty <= 0:
        #     frappe.throw(f"Planned Quantity must be greater than 0 in row {item.idx}")

    # Helper to build a clean series per Work Order
    def series_for_work_order(work_order: str) -> str:
        """
        Returns a series like: BNDL-{work_order}-.#####
        Example: work_order 'WO-0001' -> 'BNDL-WO-0001-.#####'
        This ensures per-WO counters in tabSeries.
        """
        if not work_order:
            return default_series  # fallback to common counter

        # Keep typical Frappe docname characters; remove spaces and weird chars
        safe_wo = re.sub(r"[^A-Za-z0-9\-_./]", "", str(work_order)).strip()
        # Make sure we have the literal "-." before hashes (required by make_autoname)
        return f"BNDL-{safe_wo}-.#####"

    # ✅ All valid — now generate bundles
    total_created = 0
    for item in doc.table_bundle_creation_item:
        # total_qty = int(item.planned_quantity or 0)
        total_qty = int(item.cut_quantity or 0)
        if total_qty <= 0:
            continue  # nothing to generate for this row

        units_per_bundle = int(item.unitsbundle)
        size = item.size
        work_order = getattr(item, "work_order", None)

        # Ceil division: number of bundles
        total_bundles = (total_qty + units_per_bundle - 1) // units_per_bundle

        # Build series for this row's Work Order
        per_wo_series = series_for_work_order(work_order)

        for i in range(total_bundles):
            # Quantity for this bundle
            if i == total_bundles - 1:
                bundle_qty = total_qty - units_per_bundle * (total_bundles - 1)
            else:
                bundle_qty = units_per_bundle

            # 👇 This keeps an independent counter for each Work Order automatically
            bundle_id = make_autoname(per_wo_series)

            barcode_b64 = generate_barcode_base64(bundle_id)
            qrcode_b64 = generate_qrcode_base64(bundle_id)

            doc.append("table_bundle_details", {
                "bundle_id": bundle_id,
                "unitsbundle": bundle_qty,
                "size": size,
                "barcode_image": barcode_b64,
                "qrcode_image": qrcode_b64,
                "parent_item_id": item.name,
                # Optional: persist work_order at detail level if the child doctype has it
                # "work_order": work_order,
            })
            total_created += 1

    doc.save(ignore_permissions=True)
    frappe.msgprint(f"✅ Created {total_created} bundles with per-Work-Order series, QR and Barcode.")
    