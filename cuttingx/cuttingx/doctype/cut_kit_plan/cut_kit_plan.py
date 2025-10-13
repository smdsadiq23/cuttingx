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
    Return Bundle Creation records for the Link field:
    - Must be submitted (docstatus = 1)
    - Must not already be used by another Cut Kit Plan
    - If editing, allow the bundle already set on this document to appear

    Args follow Frappe link query signature.
    """
    current_docname = (filters or {}).get("current_docname")

    args = {
        "txt_like": f"%{txt or ''}%",
        "current_docname": current_docname,
        "limit": int(page_len or 20),
        "offset": int(start or 0),
    }

    # NOT EXISTS keeps it simple and fast; allows re-selecting the current doc's bundle
    query = """
        SELECT bc.name, bc.fg_item
        FROM `tabBundle Creation` bc
        WHERE bc.docstatus = 1
          AND (%(txt_like)s = '%%' OR bc.name LIKE %(txt_like)s)
          AND NOT EXISTS (
                SELECT 1
                FROM `tabCut Kit Plan` ckp
                WHERE ckp.cut_bundle_order = bc.name
                  AND (%(current_docname)s IS NULL OR ckp.name != %(current_docname)s)
          )
        ORDER BY bc.creation DESC
        LIMIT %(limit)s OFFSET %(offset)s
    """
    return frappe.db.sql(query, args)


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
          AND tbc.activation_status = 'Completed'
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
 