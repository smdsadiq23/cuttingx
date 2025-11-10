# Copyright (c) 2025, Cognitonx Logic India Private limited and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from frappe.utils import cint  # Ensure this is imported


class CuttingLayRecord(Document):
	pass

@frappe.whitelist()
def get_cut_docket_details(cut_kanban_no):
    """
    Returns: {
        "ocn": "...",
        "style": "...",
        "colour": "..."
    }
    """
    if not cut_kanban_no or not frappe.db.exists("Cut Docket", cut_kanban_no):
        return None

    # Get parent fields: style, colour
    cut_docket = frappe.db.get_value(
        "Cut Docket",
        cut_kanban_no,
        ["style_no", "color"],
        as_dict=1
    )

    if not cut_docket:
        return None

    # Get FIRST ocn (sales_order) from child table
    ocn = frappe.db.get_value(
        "Cut Docket Item",
        {"parent": cut_kanban_no, "parenttype": "Cut Docket"},
        "sales_order",
        order_by="idx"
    )

    return {
        "ocn": ocn,
        "style": cut_docket.style_no,
        "colour": cut_docket.color
    }


@frappe.whitelist()
def get_styles_for_ocn(sales_order):
    """Return list of styles (custom_style from Sales Order Item)."""
    if not sales_order:
        return []

    styles = frappe.db.sql("""
        SELECT DISTINCT soi.custom_style
        FROM `tabSales Order Item` soi
        WHERE soi.parent = %s
          AND soi.custom_style IS NOT NULL
          AND soi.custom_style != ''
    """, (sales_order,), as_dict=1)

    return [d.custom_style for d in styles]


@frappe.whitelist()
def get_colors_for_style_in_ocn(sales_order, style):
    """Return list of colors (custom_color from Sales Order Item) for given style."""
    if not sales_order or not style:
        return []

    colors = frappe.db.sql("""
        SELECT DISTINCT soi.custom_color
        FROM `tabSales Order Item` soi
        WHERE soi.parent = %s
          AND soi.custom_style = %s
          AND soi.custom_color IS NOT NULL
          AND soi.custom_color != ''
    """, (sales_order, style), as_dict=1)

    return [d.custom_color for d in colors]


@frappe.whitelist()
def get_sizes_for_ocn(sales_order, style, colour):
    """Return distinct custom_size from Sales Order Items matching style and colour."""
    if not (sales_order and style and colour):
        return []

    sizes = frappe.db.sql("""
        SELECT DISTINCT soi.custom_size
        FROM `tabSales Order Item` soi
        WHERE 
            soi.parent = %s
            AND soi.custom_style = %s
            AND soi.custom_color = %s
            AND soi.custom_size IS NOT NULL
            AND soi.custom_size != ''
        ORDER BY soi.custom_size
    """, (sales_order, style, colour), as_dict=1)

    return [d.custom_size for d in sizes]


@frappe.whitelist()
def get_next_cut_no(cut_kanban_no, ocn, style, colour):
    if not (cut_kanban_no and ocn and style and colour):
        return 1

    max_cut_no = frappe.db.sql("""
        SELECT MAX(cut_no) 
        FROM `tabCutting Lay Record`
        WHERE 
            cut_kanban_no = %s
            AND ocn = %s
            AND style = %s
            AND colour = %s
            AND docstatus < 2
    """, (cut_kanban_no, ocn, style, colour), as_list=1)

    # Handle case where no rows exist → MAX() returns [(None,)]
    current_max = max_cut_no[0][0] if max_cut_no and max_cut_no[0][0] is not None else 0

    return cint(current_max) + 1


@frappe.whitelist()
def get_grn_items_for_style_colour(sales_order, style, colour):
    """
    Return GRN Items with net available quantity after deducting:
    - Quantity issued via Sample Fabric Issuance (by grn + roll)
    - Quantity used in Cutting Lay Records (by grn_item_reference)
    Uses separate queries + Python aggregation for clarity.
    """
    if not (sales_order and style and colour):
        return []

    # # 1. Get item codes from Sales Order
    # item_codes = frappe.db.sql_list("""
    #     SELECT DISTINCT soi.item_code
    #     FROM `tabSales Order Item` soi
    #     WHERE soi.parent = %s
    #       AND soi.custom_style = %s
    #       AND soi.custom_color = %s
    # """, (sales_order, style, colour))

    # if not item_codes:
    #     return []

    # 2. Get all relevant GRN Items (submitted GRNs only)
    grn_items = frappe.db.sql("""
        SELECT 
            gri.name AS grn_item_reference,
            gri.parent AS grn,
            gri.roll_no,
            gri.received_quantity,
            gri.fabric_width AS width,
            gri.dia
        FROM `tabGoods Receipt Item` gri
        INNER JOIN `tabGoods Receipt Note` grn ON gri.parent = grn.name
        WHERE 
            grn.ocn = %s
            AND grn.docstatus = 1
            AND gri.color = %s
            AND gri.roll_no IS NOT NULL
            AND gri.received_quantity > 0
    """, (sales_order, colour), as_dict=1)

    if not grn_items:
        return []

    # Extract keys for lookups
    grn_item_refs = [g["grn_item_reference"] for g in grn_items]
    grn_roll_pairs = [(g["grn"], g["roll_no"]) for g in grn_items]

    # 3. Get total ISSUED quantity per (grn, roll) from Sample Fabric Issuance
    issued_data = frappe.db.sql("""
        SELECT 
            grn, 
            roll, 
            SUM(issued_quantity) AS total_issued
        FROM `tabSample Fabric Issuance`
        WHERE 
            docstatus = 1
            AND grn IS NOT NULL
            AND roll IS NOT NULL
            AND (grn, roll) IN %s
        GROUP BY grn, roll
    """, (tuple(grn_roll_pairs),), as_dict=1)

    # Convert to dict: {(grn, roll): total_issued}
    issued_map = {
        (d["grn"], d["roll"]): d["total_issued"]
        for d in issued_data
    }

    # 4. Get total USED quantity per grn_item_reference from Cutting Lay Records
    used_data = frappe.db.sql("""
        SELECT 
            lr.grn_item_reference,
            SUM(lr.roll_weight) AS total_used
        FROM `tabLay Roll Details` lr
        INNER JOIN `tabCutting Lay Record` clr ON lr.parent = clr.name
        WHERE 
            clr.docstatus < 2
            AND lr.grn_item_reference IN %s
        GROUP BY lr.grn_item_reference
    """, (tuple(grn_item_refs),), as_dict=1)

    # Convert to dict: {grn_item_reference: total_used}
    used_map = {
        d["grn_item_reference"]: d["total_used"]
        for d in used_data
    }

    # 5. Compute net quantity in Python
    result = []
    for item in grn_items:
        issued_qty = issued_map.get((item["grn"], item["roll_no"]), 0.0)
        used_qty = used_map.get(item["grn_item_reference"], 0.0)
        net_qty = item["received_quantity"] - issued_qty - used_qty

        if net_qty > 0:
            result.append({
                "grn_item_reference": item["grn_item_reference"],
                "roll_no": item["roll_no"],
                "roll_weight": net_qty,  # <-- net available quantity
                "width": item["width"],
                "dia": item["dia"],
                # Optional: include breakdown for debugging
                # "original_received": item["received_quantity"],
                # "issued_quantity": issued_qty,
                # "used_in_lay": used_qty
            })

    # Sort by creation (descending) — mimic original behavior
    # Note: We lost gri.creation; if needed, add it to first query
    return sorted(result, key=lambda x: x["grn_item_reference"], reverse=True)