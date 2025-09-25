# Copyright (c) 2025, CognitionX Logic India Private limited and contributors
# For license information, please see license.txt

# import frappe
import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import flt


class CutConfirmation(Document):
    pass


def validate(doc, method):
    """
    Validate that confirmed_quantity <= planned_quantity for each item.
    """
    for item in doc.table_cut_confirmation_item:
        if flt(item.confirmed_quantity) > flt(item.planned_quantity):
            frappe.throw(
                _("Row #{0}: Confirmed Quantity ({1}) cannot be greater than Planned Quantity ({2}) for Work Order {3}, Size {4}").format(
                    item.idx,
                    item.confirmed_quantity,
                    item.planned_quantity,
                    item.work_order or "N/A",
                    item.size or "N/A"
                )
            )
        # Recalculate (optional, but safe)
        item.calculate_balance_to_confirm()
        item.calculate_total_reject()

    # Validation 2: Prevent duplicate Cut Docket
    if doc.cut_po_number:
        # Check if this Cut Docket is already used in another **submitted or saved** Cut Confirmation
        existing = frappe.db.exists(
            "Cut Confirmation",
            {
                "cut_po_number": doc.cut_po_number,
                "name": ("!=", doc.name),  # Exclude current doc
                "docstatus": ("!=", 2)     # Exclude cancelled
            }
        )
        if existing:
            frappe.throw(
                _("Cut Docket {0} has already been used in Cut Confirmation <a href='/app/cut-confirmation/{1}'>{1}</a>. "
                  "Each Cut Docket can only be confirmed once.").format(
                    frappe.bold(doc.cut_po_number),
                    existing
                ),
                title=_("Duplicate Cut Docket")
            )        


@frappe.whitelist()
def get_items_from_cut_docket(cut_po_number):
    """
    Fetch data from Cut Docket Item child table based on given docket number.
    Returns: List of dicts with fields for Cut Confirmation Item.
    """
    if not cut_po_number:
        return []

    try:
        docket_doc = frappe.get_doc("Cut Docket", cut_po_number)
    except frappe.DoesNotExistError:
        frappe.throw(_("Cut Docket {0} not found").format(cut_po_number))

    items = []
    for item in docket_doc.get("table_size_ratio_qty") or []:
        if item.ref_work_order and item.size:
            items.append({
                "work_order": item.ref_work_order,
                "sales_order": item.sales_order,
                "line_item_no": item.line_item_no,
                "size": item.size,
                "planned_quantity": item.planned_cut_quantity
            })

    return items


@frappe.whitelist()
def get_unused_cut_dockets(doctype, txt, searchfield, start, page_len, filters, as_dict=False):
    """
    Return Cut Dockets that are:
    - Submitted (docstatus = 1)
    - NOT used in any non-cancelled Cut Confirmation
    - Match search text
    """
    current_doc = filters.get("current_doc") or ""

    # Get all used Cut Dockets (excluding current doc)
    used_dockets = frappe.db.sql("""
        SELECT DISTINCT cut_po_number
        FROM `tabCut Confirmation`
        WHERE cut_po_number IS NOT NULL
          AND docstatus != 2
          AND name != %s
    """, (current_doc,), as_dict=False)

    used_list = [d[0] for d in used_dockets if d[0]]

    # Build NOT IN clause safely
    unused_condition = ""
    if used_list:
        placeholders = ','.join(['%s'] * len(used_list))
        unused_condition = f"AND name NOT IN ({placeholders})"

    # Final query
    query = f"""
        SELECT name
        FROM `tabCut Docket`
        WHERE docstatus = 1
          AND name LIKE %s
          {unused_condition}
        ORDER BY name
        LIMIT %s OFFSET %s
    """

    params = ['%' + txt + '%'] + used_list + [page_len, start]
    return frappe.db.sql(query, params)


# @frappe.whitelist()
# def get_sales_orders_from_docket(docket_name):
#     """
#     Return list of unique sales orders from Cut Docket -> Cut Docket SO Details table
#     """
#     if not docket_name:
#         return []

#     docket = frappe.get_doc("Cut Docket", docket_name)
#     sales_orders = set()

#     for row in docket.sale_order_details:
#         if row.sales_order:
#             sales_orders.add(row.sales_order)

#     return list(sales_orders)

