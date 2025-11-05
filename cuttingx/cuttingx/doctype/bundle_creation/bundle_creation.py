# Copyright (c) 2025, Cognitonx Logic India Private limited and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from labelx.utils.generators import generate_barcode_base64, generate_qrcode_base64


class BundleCreation(Document):
    def validate(self):
        """Ensure total allocated units per size or shade exactly match cut quantity or shade cut quantity."""

        validation_map = {}

        is_yarn_flow = bool(self.yarn_request_no)

        for item in self.table_bundle_creation_item:
            key = (
                item.work_order or "",
                item.sales_order or "",
                item.line_item_no or "",
                item.size or "",
            )
            if not is_yarn_flow:
                key += (item.shade or "",)

            # choose quantity field depending on flow
            qty_field = "cut_quantity" if is_yarn_flow else "shade_cut_quantity"
            base_qty = getattr(item, qty_field) or 0

            if key not in validation_map:
                validation_map[key] = {
                    "allocated": 0,
                    "expected_qty": base_qty
                }

            units_per_bundle = int(item.unitsbundle or 0)
            no_of_bundles = int(item.no_of_bundles or 0)
            expected_qty = validation_map[key]["expected_qty"]

            # Calculate allocation logic (same as generate_bundle_details)
            full_bundles = max(no_of_bundles - 1, 0)
            total_from_full = full_bundles * units_per_bundle

            remainder = expected_qty - total_from_full
            if remainder < 0:
                remainder = 0
            last_bundle_units = min(units_per_bundle, remainder)

            total_units = total_from_full + last_bundle_units
            validation_map[key]["allocated"] += total_units

        # Compare expected vs allocated for each group
        errors = []
        for key, data in validation_map.items():
            allocated = data["allocated"]
            expected = data["expected_qty"]

            if is_yarn_flow:
                work_order, sales_order, line_item, size = key
                shade_label = ""
            else:
                work_order, sales_order, line_item, size, shade = key
                shade_label = f", Shade {shade}" if shade else ""

            if allocated != expected:
                diff = allocated - expected
                direction = "greater" if diff > 0 else "less"
                errors.append(
                    f"❌ Allocated units ({allocated}) are {abs(diff)} {direction} than "
                    f"{'Cut Qty' if is_yarn_flow else 'Shade Cut Qty'} ({expected}) "
                    f"for Work Order {work_order}, Sales Order {sales_order}, "
                    f"Line Item {line_item}, Size {size}{shade_label}."
                )

        if errors:
            frappe.throw("<br>".join(errors))


    def before_save(self):
        """Remove bundle details when component is deleted before saving"""
        old_doc = self.get_doc_before_save()
        if not old_doc:
            return

        # Sets of components
        current_components = {
            row.component_name.strip()
            for row in self.table_bundle_creation_components
            if row.component_name
        }
        old_components = {
            row.component_name.strip()
            for row in old_doc.table_bundle_creation_components
            if row.component_name
        }

        deleted_components = old_components - current_components
        if deleted_components:
            frappe.db.delete(
                "Bundle Details",
                {
                    "parent": self.name,
                    "parenttype": "Bundle Creation",
                    "component": ["in", list(deleted_components)]
                }
            )
            frappe.msgprint(
                f"Removed {len(deleted_components)} component(s) from bundle details: {', '.join(deleted_components)}",
                alert=True
            )

    def on_submit(self):
        # ✅ Validate bundles are generated
        if not self.table_bundle_details or len(self.table_bundle_details) == 0:
            frappe.throw(
                _("Bundles not generated. Please click 'Create Bundles' before saving.")
            )
            
        # ✅ Create Bundle Inspection if cut_bundle_inspection is checked
        if self.cut_bundle_inspection:
            self.create_bundle_inspection()
            
    def create_bundle_inspection(self):
        """Create Cutting Bundle Inspection record when cut_bundle_inspection is checked"""
        try:
            # Check if inspection already exists
            existing = frappe.db.exists("Cutting Bundle Inspection", {
                "bundle_configuration_reference": self.name
            })
            
            if existing:
                frappe.msgprint(_("Bundle Inspection already exists: {0}").format(existing))
                return existing
                
            # Ensure bundles are generated before creating inspection
            if not self.table_bundle_details or len(self.table_bundle_details) == 0:
                frappe.msgprint(_("Generating bundle details first..."))
                generate_bundle_details(self.name)
                # Reload the document to get the generated bundle details
                self.reload()
                
            # Create new inspection
            from erpnext_trackerx_customization.erpnext_trackerx_customization.doctype.cutting_bundle_inspection.cutting_bundle_inspection import CuttingBundleInspection
            
            inspection = frappe.new_doc("Cutting Bundle Inspection")
            inspection.bundle_configuration_reference = self.name
            inspection.inspector = frappe.session.user
            
            # Copy main bundle configuration fields
            inspection.cut_docket_id = self.cut_docket_id
            inspection.fg_item = self.fg_item
            inspection.style_number = self.style_number
            inspection.color = self.color
            inspection.no_of_plies = self.no_of_plies
            inspection.tracking_tech = self.tracking_tech
            
            # Set default required values
            total_quantity = sum([item.cut_quantity for item in self.table_bundle_creation_item if item.cut_quantity])
            inspection.lot_size = int(total_quantity) if total_quantity else 1000
            
            # Set default AQL parameters
            inspection.inspection_regime = "Normal"   # This is a Select field, not a Link
            
            # Create or find default AQL Level if it doesn't exist
            aql_level_code = "2"  # Level II = code "2"
            if not frappe.db.exists("AQL Level", aql_level_code):
                aql_level = frappe.new_doc("AQL Level")
                aql_level.level_code = aql_level_code
                aql_level.level_type = "General"
                aql_level.description = "General Inspection Level II - Standard discrimination. Most commonly used general inspection level for routine inspections."
                aql_level.is_active = 1
                try:
                    aql_level.insert(ignore_permissions=True)
                except Exception as e:
                    frappe.log_error(f"Error creating AQL Level: {str(e)}")
            
            # Set inspection level to the correct level_code
            inspection.inspection_level = aql_level_code
            
            # Set default AQL values
            inspection.critical_aql = "2.5"
            inspection.major_aql = "4.0"
            inspection.minor_aql = "6.5"
            
            inspection.insert(ignore_permissions=True)
            
            # Populate child table data after creation
            inspection.populate_from_bundle_configuration()
            inspection.save(ignore_permissions=True)
            
            frappe.msgprint(_("Bundle Inspection created successfully: {0}").format(inspection.name))
            return inspection.name
            
        except Exception as e:
            frappe.log_error(f"Error creating bundle inspection: {str(e)}")
            frappe.throw(_("Failed to create Bundle Inspection: {0}").format(str(e)))


@frappe.whitelist()
def get_eligible_cut_dockets():
    # Step 1: Get all Cut Dockets used in submitted Bundle Creation
    used_in_bundle = frappe.get_all(
        'Bundle Creation',
        # filters={'docstatus': 1},
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
def get_eligible_yarn_requests():
    # Step 1: Get all Yarn Request names used in *submitted* Bundle Creation
    used_in_bundle = frappe.get_all(
        'Bundle Creation',
        # filters={'docstatus': 1},
        fields=['yarn_request_no']
    )
    used_yarn_request_names = {
        d['yarn_request_no'] for d in used_in_bundle
        if d.get('yarn_request_no')  # avoid None/empty
    }

    # Step 2: Get all *submitted* Yarn Requests (Knitting Yarn Request)
    submitted_yarn_requests = frappe.get_all(
        'Knitting Yarn Request',  # <-- Use the correct doctype name
        filters={'docstatus': 1},
        fields=['name']
    )

    # Step 3: Filter out the ones already used
    eligible = [
        d['name'] for d in submitted_yarn_requests
        if d['name'] not in used_yarn_request_names
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

###### Below functions uses make_autoname method which will store series counter and #######
###### Even if you delete bundle details it will start from counter plus 1 hence created custom method #######

# @frappe.whitelist()
# def generate_bundle_details(docname):
#     """
#     Generate bundle rows with barcode/QR for a given Bundle Creation document.
#     Each bundle generates one row per FG Component.
#     Example:
#       Bundle 1 → Front, Back, Sleeve
#       Bundle 2 → Front, Back, Sleeve
#     """
#     import re
#     doc = frappe.get_doc("Bundle Creation", docname)

#     if doc.get("table_bundle_details"):
#         frappe.msgprint("⚠️ Bundles already created. Please remove existing bundles to regenerate.")
#         return

#     if not doc.fg_item:
#         frappe.throw("Please select FG Item to generate bundles.")

#     try:
#         item_doc = frappe.get_doc("Item", doc.fg_item)
#     except frappe.DoesNotExistError:
#         frappe.throw(f"Item {doc.fg_item} not found")

#     fg_components = item_doc.get("custom_fg_components") or []
#     if not fg_components:
#         frappe.throw(f"No FG Components found for Item {doc.fg_item}")

#     company = (
#         frappe.defaults.get_user_default("Company", user=frappe.session.user)
#         or frappe.defaults.get_global_default("Company")
#     )

#     if not company:
#         frappe.throw(
#             "No Company is set for this user and no Global Default Company found. "
#             "Please set one in User Defaults or Global Defaults."
#         )

#     company_abbr = frappe.db.get_value("Company", company, "abbr")
#     if not company_abbr:
#         frappe.throw(
#             f"Company '{frappe.utils.escape_html(company)}' has no abbreviation (abbr). "
#             "Please set it in the Company master."
#         )

#     def safe_series_name(name: str) -> str:
#         if not name:
#             return "UNKNOWN"
#         return re.sub(r"[^A-Za-z0-9\-_]", "", str(name)).strip()

#     # Validate all rows before creating any bundles
#     for item in doc.table_bundle_creation_item:
#         try:
#             units_per_bundle = int(item.unitsbundle) if item.unitsbundle is not None else 0
#         except (ValueError, TypeError):
#             frappe.throw(f"Invalid Units per Bundle in row {item.idx}: must be a number")

#         if units_per_bundle <= 0:
#             frappe.throw(f"Units per bundle must be greater than 0 in row {item.idx}")

#     total_created = 0

#     for item in doc.table_bundle_creation_item:
#         total_qty = int(item.shade_cut_quantity or 0)
#         if total_qty <= 0:
#             continue

#         units_per_bundle = int(item.unitsbundle)
#         size = item.size
#         shade = item.shade
#         ply = item.ply
#         work_order = getattr(item, "work_order", None)
#         if not work_order:
#             frappe.throw(f"Work Order is missing in row {item.idx}")

#         # Ceil division: number of bundles
#         total_bundles = (total_qty + units_per_bundle - 1) // units_per_bundle

#         # Sanitize work order for series
#         safe_wo = safe_series_name(work_order)

#         # Get first 2 chars of component_name
#         comp_codes = []
#         for comp in fg_components:
#             component_name = comp.get("component_name") or "XX"
#             code = (component_name.strip()[:2].upper() if len(component_name.strip()) >= 2
#                     else (component_name + "X")[:2].upper())
#             comp_codes.append((code, component_name))

#         # ✅ Loop over bundles first
#         for bundle_idx in range(total_bundles):
#             # ✅ Generate one bundle ID per bundle
#             # Series: BNDL-MFG-{WO}-{COMP_CODE}-.#####
#             # But we need to use same base for all components
#             base_series = f"BDL-{company_abbr}-MFG-{safe_wo}-"

#             # For each component, create one row
#             for comp_code, component_name in comp_codes:
#                 # ✅ Use same bundle ID for all components in this bundle
#                 series_prefix = f"{base_series}{comp_code}-.#####"
#                 bundle_id = make_autoname(series_prefix)

#                 # Calculate quantity for this bundle
#                 if bundle_idx == total_bundles - 1:
#                     bundle_qty = total_qty - units_per_bundle * (total_bundles - 1)
#                 else:
#                     bundle_qty = units_per_bundle

#                 # Generate barcode & QR
#                 barcode_b64 = generate_barcode_base64(bundle_id)
#                 qrcode_b64 = generate_qrcode_base64(bundle_id)

#                 doc.append("table_bundle_details", {
#                     "bundle_id": bundle_id,
#                     "unitsbundle": bundle_qty,
#                     "size": size,
#                     "shade": shade,
#                     "ply": ply,
#                     "component": component_name,
#                     "barcode_image": barcode_b64,
#                     "qrcode_image": qrcode_b64,
#                     "parent_item_id": item.name,
#                 })
#                 total_created += 1

#     doc.save(ignore_permissions=True)
#     frappe.msgprint(f"✅ Created {total_created} component-wise bundle labels.")



## Since bundle split is now done in Bundle Configuration table itself we have disabled below method and created new method
## which does not calucalte no of bundles again and just use the existing
# @frappe.whitelist()
# def generate_bundle_details(docname):
#     """
#     Generate bundle rows with barcode/QR for a given Bundle Creation document.
#     Each bundle generates one row per component in table_bundle_creation_components.
#     Series numbering is continuous across all rows (does NOT restart per size/shade).
#     """
#     import re
#     doc = frappe.get_doc("Bundle Creation", docname)

#     if doc.get("table_bundle_details"):
#         frappe.msgprint("⚠️ Bundles already created. Please remove existing bundles to regenerate.")
#         return

#     if not doc.fg_item:
#         frappe.throw("Please select FG Item to generate bundles.")

#     # ✅ EARLY VALIDATION: Use components from Bundle Creation child table
#     bundle_components = doc.get("table_bundle_creation_components") or []
#     if not bundle_components:
#         frappe.throw("No components found in 'Bundle Creation Components'. Please check Style Master and Style Group Link.")

#     company = (
#         frappe.defaults.get_user_default("Company", user=frappe.session.user)
#         or frappe.defaults.get_global_default("Company")
#     )

#     if not company:
#         frappe.throw(
#             "No Company is set for this user and no Global Default Company found. "
#             "Please set one in User Defaults or Global Defaults."
#         )

#     company_abbr = frappe.db.get_value("Company", company, "abbr")
#     if not company_abbr:
#         frappe.throw(
#             f"Company '{frappe.utils.escape_html(company)}' has no abbreviation (abbr). "
#             "Please set it in the Company master."
#         )

#     def safe_series_name(name: str) -> str:
#         if not name:
#             return "UNKNOWN"
#         return re.sub(r"[^A-Za-z0-9\-_]", "", str(name)).strip()

#     # Validate all rows before creating any bundles
#     for item in doc.table_bundle_creation_item:
#         try:
#             units_per_bundle = int(item.unitsbundle) if item.unitsbundle is not None else 0
#         except (ValueError, TypeError):
#             frappe.throw(f"Invalid Units per Bundle in row {item.idx}: must be a number")

#         if units_per_bundle <= 0:
#             frappe.throw(f"Units per bundle must be greater than 0 in row {item.idx}")

#     # ✅ Prepare component codes from Bundle Creation Components (not from Item)
#     comp_codes = []
#     for row in bundle_components:
#         component_name = (row.get("component_name") or "").strip()
#         if not component_name:
#             frappe.throw(f"Component name is missing in Bundle Creation Components row {row.idx}")
        
#         code = component_name[:2].upper() if len(component_name) >= 2 else (component_name + "X")[:2].upper()
#         comp_codes.append((code, component_name))

#     # One counter per component code — global across all bundles
#     shared_counters = {comp_code: 0 for comp_code, _ in comp_codes}

#     total_created = 0

#     for item in doc.table_bundle_creation_item:
#         total_qty = int(item.shade_cut_quantity or 0)
#         if total_qty <= 0:
#             continue

#         units_per_bundle = int(item.unitsbundle)
#         size = item.size
#         shade = item.shade
#         ply = item.ply
#         work_order = getattr(item, "work_order", None)
#         if not work_order:
#             frappe.throw(f"Work Order is missing in row {item.idx}")

#         total_bundles = (total_qty + units_per_bundle - 1) 
#         safe_wo = safe_series_name(work_order)

#         for bundle_idx in range(total_bundles):
#             for comp_code, component_name in comp_codes:
#                 shared_counters[comp_code] += 1
#                 counter = shared_counters[comp_code]

#                 bundle_id = f"BDL-{company_abbr}-MFG-{safe_wo}-{comp_code}-{counter:05d}"

#                 if bundle_idx == total_bundles - 1:
#                     bundle_qty = total_qty - units_per_bundle * (total_bundles - 1)
#                 else:
#                     bundle_qty = units_per_bundle

#                 barcode_b64 = generate_barcode_base64(bundle_id)
#                 qrcode_b64 = generate_qrcode_base64(bundle_id)

#                 doc.append("table_bundle_details", {
#                     "bundle_id": bundle_id,
#                     "unitsbundle": bundle_qty,
#                     "size": size,
#                     "shade": shade,
#                     "ply": ply,
#                     "component": component_name,
#                     "barcode_image": barcode_b64,
#                     "qrcode_image": qrcode_b64,
#                     "parent_item_id": item.name,
#                 })
#                 total_created += 1

#     doc.save(ignore_permissions=True)
#     frappe.msgprint(f"✅ Created {total_created} component-wise bundle labels with continuous numbering.")


@frappe.whitelist()
def generate_bundle_details(docname, is_yarn_flow: bool = False):
    """
    Generate bundle rows for Bundle Creation document.

    - For both flows (Cut Docket and Yarn Request):
        Each bundle item is replicated per component.
    - For Yarn Request flow:
        Shade and Ply are ignored (None).
    """

    import re
    doc = frappe.get_doc("Bundle Creation", docname)

    # detect yarn flow from either flag or field
    is_yarn_flow = frappe.utils.cint(is_yarn_flow) or bool(doc.yarn_request_no)

    if doc.get("table_bundle_details"):
        frappe.msgprint("⚠️ Bundles already created. Please remove existing bundles to regenerate.")
        return

    if not doc.fg_item:
        frappe.throw("Please select FG Item to generate bundles.")

    # ✅ Components are always required now
    bundle_components = doc.get("table_bundle_creation_components") or []
    if not bundle_components:
        frappe.throw(
            "No components found in 'Bundle Creation Components'. "
            "Please check Style Master and Style Group Link."
        )

    # Get company abbreviation
    company = (
        frappe.defaults.get_user_default("Company", user=frappe.session.user)
        or frappe.defaults.get_global_default("Company")
    )
    if not company:
        frappe.throw("No Company found in User Defaults or Global Defaults.")

    company_abbr = frappe.db.get_value("Company", company, "abbr") or "CMP"

    def safe_series_name(name: str) -> str:
        if not name:
            return "UNKNOWN"
        return re.sub(r"[^A-Za-z0-9\-_]", "", str(name)).strip()

    # Prepare component codes
    comp_codes = []
    for row in bundle_components:
        component_name = (row.get("component_name") or "").strip()
        if not component_name:
            frappe.throw(f"Component name is missing in Bundle Creation Components row {row.idx}")
        code = component_name[:2].upper() if len(component_name) >= 2 else (component_name + "X")[:2].upper()
        comp_codes.append((code, component_name))

    # Shared counter per component code (continuous numbering)
    shared_counters = {comp_code: 0 for comp_code, _ in comp_codes}
    total_created = 0

    for item in doc.table_bundle_creation_item:
        work_order = item.work_order
        size = item.size
        units_per_bundle = frappe.utils.cint(item.unitsbundle)
        num_bundles = frappe.utils.cint(item.no_of_bundles)
        if units_per_bundle <= 0 or num_bundles <= 0:
            frappe.log_error(
                f"Skipping invalid bundle row (unitsbundle={units_per_bundle}, no_of_bundles={num_bundles}) for item {item.name}",
                "Bundle Creation Validation"
            )
            continue

        safe_wo = safe_series_name(work_order)
        base_qty = (
            item.cut_quantity if is_yarn_flow else (item.shade_cut_quantity or 0)
        )

        # For Yarn flow, ignore shade/ply
        shade = None if is_yarn_flow else item.shade
        ply = None if is_yarn_flow else item.ply

        for bundle_num in range(num_bundles):
            for comp_code, component_name in comp_codes:
                shared_counters[comp_code] += 1
                counter = shared_counters[comp_code]

                bundle_id = f"BDL-{company_abbr}-MFG-{safe_wo}-{comp_code}-{counter:05d}"

                barcode_b64 = generate_barcode_base64(bundle_id)
                qrcode_b64 = generate_qrcode_base64(bundle_id)

                doc.append("table_bundle_details", {
                    "bundle_id": bundle_id,
                    "unitsbundle": units_per_bundle,
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

    frappe.msgprint(
        f"✅ Created {total_created} component-wise bundle label(s) with continuous numbering "
        f"({'Yarn Request' if is_yarn_flow else 'Cut Docket'} flow)."
    )
