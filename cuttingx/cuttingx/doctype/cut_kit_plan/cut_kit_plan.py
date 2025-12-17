# Copyright (c) 2025, Cognitonx Logic India Private Limited and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from frappe.utils import cint
import json
from collections import defaultdict, deque

from cuttingx.cuttingx.utils.process_map_ops import (
    get_operations_from_process_map_core,
    build_operation_map_from_process_map,
    populate_physical_cell_first_and_last_operations
)

class CutKitPlan(Document):
    def before_save(self):
        if not self.fg_item:
            return

        if not self.style or not self.colour:
            item_doc = frappe.get_cached_doc("Item", self.fg_item)
            if not self.style:
                self.style = item_doc.get("custom_style_master") or ""
            if not self.colour:
                self.colour = item_doc.get("custom_colour_name") or ""


    def before_submit(self, doc=None, method=None):
        """
        Before submitting Cut Kit Plan:
        1. Populate table_operation_map from Process Map
        2. Set last_operation (via util)
        3. Populate table_physical_cell_first_and_last_operation
        """
        # Handle Frappe's calling convention
        doc = doc or self

        if not doc.operation_map:
            frappe.throw("Process Map is mandatory for Cut Kit Plan submission.")

        # === STEP 1 & 2: Build operation map + last_operation from Process Map ===
        build_operation_map_from_process_map(
            doc,
            process_map_field="operation_map",
            op_map_child_table="table_operation_map",
            last_operation_field="last_operation",
        )

        # === STEP 3: Populate physical cell first & last operations ===
        populate_physical_cell_first_and_last_operations(
            doc,
            op_map_child_table="table_operation_map",
            dest_child_table="table_physical_cell_first_and_last_operation",
            physical_cell_field="physical_cell",
            first_op_field="first_operation",
            last_op_field="last_operation",
        )

        frappe.logger().info(f"Updated operations for Cut Kit Plan {doc.name}")       
                
                
@frappe.whitelist()
def filter_available_bundles(doctype, txt, searchfield, start, page_len, filters):
    """
    Return available Bundle Creation records:
    - Submitted (docstatus = 1)
    - Match search text
    - Have at least one unused production_item (by ID) not referenced in Cut Kit Plan Bundle Details
    - OR is the currently selected bundle (to allow editing)
    """
    current_bundle = (filters or {}).get("current_bundle")
    txt = txt or ""
    start = cint(start)
    page_len = cint(page_len) or 20

    # Step 1: Get all submitted bundles matching search
    bundles = frappe.db.sql("""
        SELECT name, fg_item
        FROM `tabBundle Creation`
        WHERE docstatus = 1
          AND (%(txt)s = '' OR name LIKE %(like_txt)s)
        ORDER BY creation DESC
    """, {
        "txt": txt,
        "like_txt": f"%{txt}%"
    }, as_dict=True)

    if not bundles:
        return []

    bundle_names = [b.name for b in bundles]

    # Step 2: Get all production_item IDs linked to these bundles
    # (via Tracking Order → Bundle Configuration → Production Item)
    bundle_to_item_ids = frappe.db.sql("""
        SELECT 
            pi.name AS production_item_id,
            tor.reference_order_number AS bundle_name
        FROM `tabProduction Item` pi
        INNER JOIN `tabTracking Order Bundle Configuration` tbc 
            ON pi.bundle_configuration = tbc.name
        INNER JOIN `tabTracking Order` tor 
            ON tbc.parent = tor.name
        WHERE tor.reference_order_number IN %(bundle_names)s
          AND tbc.source = 'Activation'
    """, {"bundle_names": bundle_names}, as_dict=True)

    if not bundle_to_item_ids:
        # No production items linked → only current bundle may be shown
        if current_bundle:
            matching = [b for b in bundles if b.name == current_bundle]
            if matching:
                return [(matching[0].name, matching[0].fg_item)]
        return []

    # Step 3: Get all already-used production_item IDs (by ID, not number)
    used_item_ids = set(frappe.db.sql_list("""
        SELECT DISTINCT production_item_id
        FROM `tabCut Kit Plan Bundle Details`
        WHERE production_item_id IS NOT NULL
    """))

    # Step 4: Determine which bundles have at least one unused production_item
    available_bundles = []
    from collections import defaultdict
    items_by_bundle = defaultdict(list)
    
    for row in bundle_to_item_ids:
        items_by_bundle[row.bundle_name].append(row.production_item_id)

    for bundle in bundles:
        name = bundle.name

        # Always include the currently selected bundle
        if name == current_bundle:
            available_bundles.append((name, bundle.fg_item))
            continue

        item_ids = items_by_bundle.get(name, [])
        if not item_ids:
            continue

        # Check if ANY production_item ID is unused
        has_unused = any(item_id not in used_item_ids for item_id in item_ids)
        if has_unused:
            available_bundles.append((name, bundle.fg_item))

    # Step 5: Apply pagination
    paginated = available_bundles[start : start + page_len]
    return paginated


@frappe.whitelist()
def get_auto_fill_data(fg_item):
    if not fg_item:
        return {}

    try:
        item_doc = frappe.get_cached_doc("Item", fg_item)
        style = item_doc.get("custom_style_master") or ""
        colour = item_doc.get("custom_colour_name") or ""
    except Exception:
        style = ""
        colour = ""

    bundle_info = frappe.db.sql("""
        SELECT bi.sales_order, bi.work_order
        FROM `tabBundle Creation Item` bi
        INNER JOIN `tabBundle Creation` b ON bi.parent = b.name
        WHERE b.fg_item = %s
        ORDER BY b.creation DESC
        LIMIT 1
    """, fg_item, as_dict=True)

    sales_order = bundle_info[0].sales_order if bundle_info else None
    work_order = bundle_info[0].work_order if bundle_info else None

    return {
        "sales_order": sales_order,
        "work_order": work_order,
        "style": style,
        "colour": colour
    }


# Define operations to IGNORE (case-sensitive)
IGNORED_OPERATIONS = {
    "Activation",
    "UnLink Link",
    "Unlink",
    "Switch"
}


# Fetch Operations based on Nodes and sequence based on Edges
@frappe.whitelist()
def get_operations_from_process_map(process_map_name):
    """
    Whitelisted wrapper that delegates to the shared util.

    Kept at same dotted path so existing JS that calls
    trackerx_live.trackerx_live.doctype.cut_kit_plan.cut_kit_plan.get_operations_from_process_map
    keeps working.
    """
    return get_operations_from_process_map_core(process_map_name)


# Single method to fetch both bundle details and unique components
@frappe.whitelist()
def get_bundle_details_with_components(bundle_creation_name):
    if not bundle_creation_name:
        return {"bundle_details": [], "unique_components": []}

    # Step 1: Fetch components from Bundle Creation in idx order
    bundle_creation_components = frappe.db.sql("""
        SELECT component_name
        FROM `tabBundle Creation Components`
        WHERE parent = %s
        ORDER BY idx
    """, bundle_creation_name, as_dict=True)

    # Maintain order and avoid duplicates while preserving first occurrence
    seen = set()
    unique_components = []
    for row in bundle_creation_components:
        comp = row.get("component_name")
        if comp and comp not in seen:
            unique_components.append(comp)
            seen.add(comp)

    if not unique_components:
        return {"bundle_details": [], "unique_components": []}

    allowed_components = set(unique_components)

    # Step 2: Fetch bundle details — now include pi.name as production_item_id
    bundle_details = frappe.db.sql("""
        SELECT 
            pi.name AS production_item_id,  
            pi.production_item_number, 
            tbc.shade, 
            tbc.size, 
            tc.component_name AS component, 
            tbc.bundle_quantity AS bundle_qty 
        FROM `tabProduction Item` pi
        INNER JOIN `tabTracking Order Bundle Configuration` tbc 
            ON pi.bundle_configuration = tbc.name
        INNER JOIN `tabTracking Order` tor 
            ON tbc.parent = tor.name
        INNER JOIN `tabTracking Component` tc 
            ON tc.parent = tor.name AND tbc.component = tc.name
        WHERE tor.reference_order_number = %s 
          AND tbc.source = 'Activation' 
        ORDER BY pi.bundle_configuration, pi.production_item_number
    """, bundle_creation_name, as_dict=True)

    if not bundle_details:
        return {"bundle_details": [], "unique_components": unique_components}

    frappe.log_error(
        message=frappe.as_json(bundle_details, indent=2),
        title="Bundle Details (Raw) - get_bundle_details_with_components"
    )

    # Step 3: Get existing production_item_id values (NOT production_item_number)
    existing_item_ids = set(
        frappe.db.sql_list("""
            SELECT DISTINCT production_item_id 
            FROM `tabCut Kit Plan Bundle Details`
            WHERE production_item_id IS NOT NULL
        """)
    )

    # Step 4: Filter bundle details:
    # - Exclude already used production_item_id
    # - Only keep rows where component is in allowed_components
    filtered_bundle_details = [
        row for row in bundle_details
        if row.production_item_id not in existing_item_ids
        and row.component in allowed_components
    ]

    # Optional: Sort by component order from Bundle Creation
    component_order = {comp: i for i, comp in enumerate(unique_components)}
    filtered_bundle_details.sort(
        key=lambda x: component_order.get(x.component, 999999)
    )

    frappe.log_error(
        message=frappe.as_json(filtered_bundle_details, indent=2),
        title="Filtered Bundle Details - get_bundle_details_with_components"
    )

    return {
        "bundle_details": filtered_bundle_details,
        "unique_components": unique_components
    }