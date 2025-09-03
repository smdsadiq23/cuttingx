# Copyright (c) 2025, Cognitonx Logic India Private limited and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from labelx.utils.generators import generate_barcode_base64, generate_qrcode_base64
from frappe.model.naming import make_autoname


class BundleCreation(Document):
    def validate(self):
        # ✅ Validate bundles are generated
        if not self.table_bundle_details or len(self.table_bundle_details) == 0:
            frappe.throw(
                _("Bundles not generated. Please click 'Create Bundles' before saving.")
            )


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
        fields=['work_order', 'sales_order', 'line_item_no', 'size', 'confirmed_quantity', 'idx'],
        order_by='idx'
    )

    # Return data in desired structure
    return [
        {
            'work_order': item['work_order'],
            'sales_order': item['sales_order'],
            'line_item_no': item['line_item_no'],
            'size': item['size'],
            'cut_quantity': item['confirmed_quantity'],
            'idx': item['idx']  # Keep idx for sorting
        }
        for item in items
    ]


@frappe.whitelist()
def generate_bundle_details(docname):
    """
    Generate bundle rows with barcode/QR for a given Bundle Creation document.
    Each bundle generates one row per FG Component.
    Example:
      Bundle 1 → Front, Back, Sleeve
      Bundle 2 → Front, Back, Sleeve
    """
    import re
    doc = frappe.get_doc("Bundle Creation", docname)

    if doc.get("table_bundle_details"):
        frappe.msgprint("⚠️ Bundles already created. Please remove existing bundles to regenerate.")
        return

    if not doc.fg_item:
        frappe.throw("Please select FG Item to generate bundles.")

    try:
        item_doc = frappe.get_doc("Item", doc.fg_item)
    except frappe.DoesNotExistError:
        frappe.throw(f"Item {doc.fg_item} not found")

    fg_components = item_doc.get("custom_fg_components") or []
    if not fg_components:
        frappe.throw(f"No FG Components found for Item {doc.fg_item}")

    # ✅ Get company via fallback
    company = None

    # 1. Try from user's default company
    user_company = frappe.defaults.get_user_default("company", user=frappe.session.user)
    if user_company:
        company = user_company


    # ✅ Get company abbreviation
    company_abbr = frappe.db.get_value("Company", company, "abbr")
    if not company_abbr:
        frappe.throw(f"Company {company} has no abbreviation (abbr). Please set it in Company master.")      

    def safe_series_name(name: str) -> str:
        if not name:
            return "UNKNOWN"
        return re.sub(r"[^A-Za-z0-9\-_]", "", str(name)).strip()

    # Validate all rows before creating any bundles
    for item in doc.table_bundle_creation_item:
        try:
            units_per_bundle = int(item.unitsbundle) if item.unitsbundle is not None else 0
        except (ValueError, TypeError):
            frappe.throw(f"Invalid Units per Bundle in row {item.idx}: must be a number")

        if units_per_bundle <= 0:
            frappe.throw(f"Units per bundle must be greater than 0 in row {item.idx}")

    total_created = 0

    for item in doc.table_bundle_creation_item:
        total_qty = int(item.shade_cut_quantity or 0)
        if total_qty <= 0:
            continue

        units_per_bundle = int(item.unitsbundle)
        size = item.size
        shade = item.shade
        ply = item.ply
        work_order = getattr(item, "work_order", None)
        if not work_order:
            frappe.throw(f"Work Order is missing in row {item.idx}")

        # Ceil division: number of bundles
        total_bundles = (total_qty + units_per_bundle - 1) // units_per_bundle

        # Sanitize work order for series
        safe_wo = safe_series_name(work_order)

        # Get first 2 chars of component_name
        comp_codes = []
        for comp in fg_components:
            component_name = comp.get("component_name") or "XX"
            code = (component_name.strip()[:2].upper() if len(component_name.strip()) >= 2
                    else (component_name + "X")[:2].upper())
            comp_codes.append((code, component_name))

        # ✅ Loop over bundles first
        for bundle_idx in range(total_bundles):
            # ✅ Generate one bundle ID per bundle
            # Series: BNDL-MFG-{WO}-{COMP_CODE}-.#####
            # But we need to use same base for all components
            base_series = f"BDL-{company_abbr}-MFG-{safe_wo}-"

            # For each component, create one row
            for comp_code, component_name in comp_codes:
                # ✅ Use same bundle ID for all components in this bundle
                series_prefix = f"{base_series}{comp_code}-.#####"
                bundle_id = make_autoname(series_prefix)

                # Calculate quantity for this bundle
                if bundle_idx == total_bundles - 1:
                    bundle_qty = total_qty - units_per_bundle * (total_bundles - 1)
                else:
                    bundle_qty = units_per_bundle

                # Generate barcode & QR
                barcode_b64 = generate_barcode_base64(bundle_id)
                qrcode_b64 = generate_qrcode_base64(bundle_id)

                doc.append("table_bundle_details", {
                    "bundle_id": bundle_id,
                    "unitsbundle": bundle_qty,
                    "size": size,
                    "shade": shade,
                    "ply": ply,
                    "component": component_name,
                    "barcode_image": barcode_b64,
                    "qrcode_image": qrcode_b64,
                    "parent_item_id": item.name,
                })
                total_created += 1

    doc.save(ignore_permissions=True)
    frappe.msgprint(f"✅ Created {total_created} component-wise bundle labels.")