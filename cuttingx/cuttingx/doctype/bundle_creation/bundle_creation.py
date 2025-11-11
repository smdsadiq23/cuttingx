# Copyright (c) 2025, Cognitonx Logic India Private limited and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from labelx.utils.generators import generate_barcode_base64, generate_qrcode_base64


class BundleCreation(Document):
    def autoname(self):
        """
        Custom naming: BC-{First_Work_Order}-0001
        Example: BC-WO-00123-0001
        """
        work_order = None

        # Get first valid Work Order from child table `table_bundle_creation_item`
        if self.table_bundle_creation_item:
            for row in self.table_bundle_creation_item:
                if row.work_order:
                    work_order = row.work_order
                    break

        if not work_order:
            frappe.throw(
                _("At least one Work Order must be selected in Bundle Creation Items to generate document name.")
            )

        # Sanitize Work Order name (replace /, \, spaces to ensure valid naming)
        wo_clean = str(work_order).replace("/", "-").replace("\\", "-").replace(" ", "-")

        # Generate auto-incrementing name: BC-{WO}-0001
        prefix = f"BC-{wo_clean}"
        self.name = frappe.model.naming.make_autoname(prefix + "-.####")
        

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
    """
    Return Cut Dockets that have at least one:
    - Submitted Cut Confirmation, AND
    - That Cut Confirmation is NOT used in any Bundle Creation
    """
    # Step 1: Get all Cut Confirmations used in Bundle Creation
    used_confirmations = frappe.get_all(
        "Bundle Creation",
        filters={"cut_confirmation_no": ["is", "set"]},
        pluck="cut_confirmation_no"
    )
    used_confirmation_set = set(used_confirmations)

    # Step 2: Get all submitted Cut Confirmations NOT in used set
    eligible_confirmations = frappe.get_all(
        "Cut Confirmation",
        filters={
            "docstatus": 1,
            "name": ["not in", list(used_confirmation_set)] if used_confirmation_set else ""
        },
        pluck="cut_po_number"  # Cut Docket ID
    )

    # Step 3: Deduplicate Cut Dockets (one Cut Docket may have multiple unused confirmations)
    eligible_dockets = list(set(eligible_confirmations))

    return eligible_dockets


@frappe.whitelist()
def get_eligible_cut_confirmations(doctype, txt, searchfield, start, page_len, filters):
    cut_docket_id = filters.get("cut_docket_id")
    if not cut_docket_id:
        return []

    # Get used Cut Confirmations for THIS Cut Docket only
    used_list = frappe.db.sql("""
        SELECT DISTINCT bc.cut_confirmation_no
        FROM `tabBundle Creation` bc
        INNER JOIN `tabCut Confirmation` cc
            ON bc.cut_confirmation_no = cc.name
        WHERE bc.cut_confirmation_no IS NOT NULL
        AND cc.cut_po_number = %s
    """, (cut_docket_id,), as_dict=0)

    used_names = [row[0] for row in used_list if row[0]]
    
    # Base conditions
    conditions = "cc.docstatus != 2 AND cc.cut_po_number = %s AND cc.name LIKE %s"
    params = [cut_docket_id, f"%{txt}%", int(page_len), int(start)]

    if used_names:
        placeholders = ",".join(["%s"] * len(used_names))
        conditions += f" AND cc.name NOT IN ({placeholders})"
        params = [cut_docket_id, f"%{txt}%"] + used_names + [int(page_len), int(start)]

    query = f"""
        SELECT cc.name
        FROM `tabCut Confirmation` cc
        WHERE {conditions}
        ORDER BY cc.name
        LIMIT %s OFFSET %s
    """

    return frappe.db.sql(query, params)


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
def get_items_from_cut_confirmation(cut_confirmation_no):
    """
    Fetch items from a SPECIFIC Cut Confirmation (not by Cut Docket).
    """
    if not cut_confirmation_no:
        return []

    # Optional: Validate that the Cut Confirmation exists and is submitted
    if not frappe.db.exists("Cut Confirmation", cut_confirmation_no):
        frappe.throw(_("Cut Confirmation {0} not found").format(cut_confirmation_no))

    docstatus = frappe.db.get_value("Cut Confirmation", cut_confirmation_no, "docstatus")
    if docstatus != 1:
        frappe.throw(_("Cut Confirmation {0} must be submitted to create bundles").format(cut_confirmation_no))

    items = frappe.get_all(
        "Cut Confirmation Item",
        filters={"parent": cut_confirmation_no},
        fields=["work_order", "sales_order", "line_item_no", "size", "confirmed_quantity", "idx"],
        order_by="idx"
    )

    return [
        {
            "work_order": item.work_order,
            "sales_order": item.sales_order,
            "line_item_no": item.line_item_no,
            "size": item.size,
            "cut_quantity": item.confirmed_quantity,
            "idx": item.idx
        }
        for item in items
    ]

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
