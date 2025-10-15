# Copyright (c) 2025, Cognitonx Logic India Private limited and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from frappe.utils import cint  # Ensure this is imported


class CuttingLayRecord(Document):
	pass


@frappe.whitelist()
def sales_order_query_by_byyer(doctype, txt, searchfield, start, page_len, filters):
    # Ensure filters is a dict
    if isinstance(filters, str):
        filters = frappe.parse_json(filters)

    customer = filters.get("customer")
    if not customer:
        return []

    return frappe.db.sql("""
        SELECT name, customer, transaction_date
        FROM `tabSales Order`
        WHERE docstatus = 1
          AND customer = %(customer)s
          AND name LIKE %(txt)s
        ORDER BY transaction_date DESC
        LIMIT %(start)s, %(page_len)s
    """, {
        "customer": customer,
        "txt": "%" + txt + "%",
        "start": int(start),
        "page_len": int(page_len)
    })


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
def get_next_cut_no(buyer, ocn, style, colour):
    if not (buyer and ocn and style and colour):
        return 1

    max_cut_no = frappe.db.sql("""
        SELECT MAX(cut_no) 
        FROM `tabCutting Lay Record`
        WHERE 
            buyer = %s
            AND ocn = %s
            AND style = %s
            AND colour = %s
            AND docstatus < 2
    """, (buyer, ocn, style, colour), as_list=1)

    # Handle case where no rows exist → MAX() returns [(None,)]
    current_max = max_cut_no[0][0] if max_cut_no and max_cut_no[0][0] is not None else 0

    return cint(current_max) + 1


@frappe.whitelist()
def get_grn_items_for_style_colour(sales_order, style, colour):
    """
    Return GRN Items where:
    - item_code matches Sales Order Item with given style
    - color matches given colour
    - NOT used in ANY Cutting Lay Record (globally)
    """
    if not (sales_order and style and colour):
        return []

    # Get item_codes from Sales Order Items matching style
    item_codes = frappe.db.sql_list("""
        SELECT DISTINCT soi.item_code
        FROM `tabSales Order Item` soi
        WHERE soi.parent = %s
          AND soi.custom_style = %s
          AND soi.custom_color = %s
    """, (sales_order, style, colour))

    if not item_codes:
        return []

    # Fetch GRN items that are NOT used in any Cutting Lay Record
    grn_items = frappe.db.sql("""
        SELECT 
            gri.name AS grn_item_reference,
            gri.roll_no AS roll_no,            
            gri.received_quantity AS roll_weight,
            gri.fabric_width AS width,
            gri.dia AS dia
        FROM `tabGoods Receipt Item` gri
        INNER JOIN `tabGoods Receipt Note` grn ON gri.parent = grn.name 
        WHERE 
            grn.ocn = %(ocn)s           
            AND grn.docstatus = 1
            AND gri.item_code IN %(item_codes)s
            AND gri.color = %(colour)s
            AND gri.name NOT IN (
                SELECT DISTINCT lr.grn_item_reference
                FROM `tabLay Roll Details` lr
                INNER JOIN `tabCutting Lay Record` clr ON lr.parent = clr.name
                WHERE clr.docstatus < 2  -- Draft + Submitted
                  AND lr.grn_item_reference IS NOT NULL
            )
        ORDER BY gri.creation DESC
    """, {
        "ocn": sales_order,
        "item_codes": tuple(item_codes),
        "colour": colour
    }, as_dict=1)

    return grn_items