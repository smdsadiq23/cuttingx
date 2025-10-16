# Copyright (c) 2025, Cognitonx Logic India Private Limited and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


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
                
                
@frappe.whitelist()
def filter_available_bundles(doctype, txt, searchfield, start, page_len, filters):
    """
    Return available Bundle Creation records:
    - Submitted (docstatus = 1)
    - Match search text
    - Have at least one unused production_item_number (not in Cut Kit Plan Bundle Details)
    - OR is the currently selected bundle (to allow editing)
    """
    from frappe.utils import cint

    current_bundle = (filters or {}).get("current_bundle")
    txt = txt or ""
    start = cint(start)
    page_len = cint(page_len) or 20

    # Step 1: Get all submitted bundles matching search (minimal SQL)
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

    # Step 2: Get all production_item_number -> bundle mapping for these bundles
    # (Only for 'Activation' & 'Completed' lines)
    bundle_to_items = frappe.db.sql("""
        SELECT 
            pi.production_item_number,
            tor.reference_order_number AS bundle_name
        FROM `tabProduction Item` pi
        INNER JOIN `tabTracking Order Bundle Configuration` tbc 
            ON pi.bundle_configuration = tbc.name
        INNER JOIN `tabTracking Order` tor 
            ON tbc.parent = tor.name
        WHERE tor.reference_order_number IN %(bundle_names)s
          AND tbc.source = 'Activation'
    """, {"bundle_names": bundle_names}, as_dict=True)

    # Step 3: Get all already-used production_item_number
    used_items = set(frappe.db.sql_list("""
        SELECT DISTINCT production_item_number
        FROM `tabCut Kit Plan Bundle Details`
        WHERE production_item_number IS NOT NULL
    """))

    # Step 4: For each bundle, check if it has ANY unused item
    available_bundles = []
    bundle_has_unused = {}

    # Group items by bundle
    from collections import defaultdict
    items_by_bundle = defaultdict(list)
    for row in bundle_to_items:
        items_by_bundle[row.bundle_name].append(row.production_item_number)

    for bundle in bundles:
        name = bundle.name

        # Always include current bundle (even if fully used)
        if name == current_bundle:
            available_bundles.append((name, bundle.fg_item))
            continue

        items = items_by_bundle.get(name, [])
        if not items:
            continue  # no valid bundle lines

        # Check if ANY item is unused
        has_unused = any(item not in used_items for item in items)
        if has_unused:
            available_bundles.append((name, bundle.fg_item))

    # Step 5: Apply pagination (start, page_len)
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


@frappe.whitelist()
def filter_suppliers_by_order_method(doctype, txt, searchfield, start, page_len, filters):
    order_method = filters.get("order_method")
    if not order_method:
        return []

    suppliers = frappe.db.sql("""
        SELECT DISTINCT sfg.supplier, sup.supplier_name
        FROM `tabBOM Order Method Cost` omc
        INNER JOIN `tabSupplier FG Items` sfg ON omc.parent = sfg.name
        INNER JOIN `tabSupplier` sup ON sfg.supplier = sup.name
        WHERE 
            omc.omc_order_method = %s
            AND sfg.supplier IS NOT NULL
            AND (sup.name LIKE %s OR sup.supplier_name LIKE %s)
        LIMIT %s OFFSET %s
    """, (
        order_method,
        "%" + txt + "%",
        "%" + txt + "%",
        int(page_len),
        int(start)
    ))

    return [(row[1] or row[0], row[0]) for row in suppliers if row[0]]


import frappe
from frappe import _

# Define operations to IGNORE (case-sensitive)
IGNORED_OPERATIONS = {
    "Activation",
    "UnLink Link",
    "Unlink",
    "Switch"
}

@frappe.whitelist()
def get_operations_from_process_map(process_map_name):
    """
    Fetches operation labels from 'nodes' in Process Map,
    excluding blacklisted operations.
    """
    if not process_map_name:
        return []

    try:
        doc = frappe.get_doc("Process Map", process_map_name)
    except frappe.DoesNotExistError:
        frappe.log_error(
            title="Process Map Not Found",
            message=f"Process Map '{process_map_name}' does not exist."
        )
        return []

    nodes = doc.get("nodes")
    if not nodes:
        return []

    try:
        if isinstance(nodes, str):
            data = frappe.parse_json(nodes)
        else:
            data = nodes
    except Exception as e:
        frappe.log_error(
            title="Process Map Parse Error",
            message=f"Invalid JSON in 'nodes' of Process Map '{process_map_name}': {str(e)}"
        )
        return []

    if not isinstance(data, list):
        return []

    operations = [
        node.get("label")
        for node in data
        if (
            isinstance(node, dict)
            and node.get("type") == "operationProcess"
            and node.get("label")
            and node.get("label") not in IGNORED_OPERATIONS  # ← FILTER HERE
        )
    ]

    return operations
    

# NEW: Single method to fetch both bundle details and unique components
@frappe.whitelist()
def get_bundle_details_with_components(bundle_creation_name):
    if not bundle_creation_name:
        return {"bundle_details": [], "unique_components": []}

    # Step 1: Get all bundle details (without exclusion)
    bundle_details = frappe.db.sql("""
        SELECT 
            pi.production_item_number, 
            tbc.shade, 
            tbc.size, 
            tc.component_name AS 'component', 
            tbc.bundle_quantity AS 'bundle_qty' 
        FROM `tabProduction Item` pi
        INNER JOIN `tabTracking Order Bundle Configuration` tbc 
            ON pi.`bundle_configuration` = tbc.name
        INNER JOIN `tabTracking Order` tor 
            ON tbc.parent = tor.name
        INNER JOIN `tabTracking Component` tc 
            ON tc.parent = tor.name AND tbc.component = tc.name
        WHERE tor.`reference_order_number` = %s 
          AND tbc.source = 'Activation' 
        ORDER BY pi.production_item_number
    """, bundle_creation_name, as_dict=True)

    if not bundle_details:
        return {"bundle_details": [], "unique_components": []}

    # Step 2: Get all production_item_numbers already in Cut Kit Plan Bundle Details
    existing_items = set(
        frappe.db.sql_list("""
            SELECT DISTINCT production_item_number 
            FROM `tabCut Kit Plan Bundle Details`
            WHERE production_item_number IS NOT NULL
        """)
    )

    # Step 3: Filter out items that are already in Cut Kit Plan
    filtered_bundle_details = [
        row for row in bundle_details
        if row.production_item_number not in existing_items
    ]

    # Step 4: Extract and sort unique components
    unique_components = sorted({
        row.component for row in filtered_bundle_details if row.component
    })

    return {
        "bundle_details": filtered_bundle_details,
        "unique_components": unique_components
    }
 