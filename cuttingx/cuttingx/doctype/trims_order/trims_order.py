# Copyright (c) 2025, Cognitonx Logic India Private limited and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from frappe import _


class TrimsOrder(Document):
    pass

@frappe.whitelist()
def get_grouped_trims_summary_data(work_order):
    if not work_order:
        return []

    query = """
        SELECT
            sales_order,
            size,
            MIN(wo_quantity) as wo_quantity,
            SUM(trims_order_quantity) as already_issued_quantity
        FROM
            `tabTrims Order Summary`
        WHERE
            parent IN (
                SELECT name FROM `tabTrims Order`
                WHERE work_order = %(work_order)s
            )
        GROUP BY
            sales_order, size
    """
    data = frappe.db.sql(query, {"work_order": work_order}, as_dict=True)
    return data


@frappe.whitelist()
def get_fallback_summary_trims(work_order):
    """Return summary rows grouped by (SALES ORDER, SIZE) with total WO quantity."""
    if not work_order:
        return []

    wo = frappe.get_doc("Work Order", work_order)

    from frappe.utils import flt
    totals = {}

    for line in (wo.custom_work_order_line_items or []):
        key = ((line.sales_order or "").strip(), (line.size or "").strip())
        totals[key] = totals.get(key, 0) + flt(line.work_order_allocated_qty)

    summary = [{"sales_order": so, "size": size, "wo_quantity": qty}
               for (so, size), qty in totals.items()]
    summary.sort(key=lambda x: (x["sales_order"] or "", x["size"] or ""))
    return summary


@frappe.whitelist()
def get_grouped_trims_data(work_order):
    if not work_order:
        return []

    query = """
        SELECT
            sales_order,
            line_item_no,
            size,
            item_type,
            item_code,
            uom,
            MIN(per_unit_quantity) as per_unit_quantity,
            MIN(wo_quantity) as wo_quantity
        FROM
            `tabTrims Order Item`
        WHERE
            parent IN (
                SELECT name FROM `tabTrims Order`
                WHERE work_order = %(work_order)s
            )
        GROUP BY
            sales_order, size, item_type, item_code, uom
    """
    data = frappe.db.sql(query, {"work_order": work_order}, as_dict=True)
    return data


@frappe.whitelist()
def get_fallback_bom_trims(work_order):
    if not work_order:
        return []

    wo = frappe.get_doc("Work Order", work_order)
    if not wo.bom_no:
        frappe.throw("No BOM found in the selected Work Order")

    bom = frappe.get_doc("BOM", wo.bom_no)
    results = []
    
    for line in wo.custom_work_order_line_items:
        sales_order = line.sales_order
        line_item_no = line.line_item_no        
        size = line.size
        wo_qty = line.work_order_allocated_qty    

        for bom_item in bom.items:
            if bom_item.custom_item_type != "Fabrics" and (bom_item.custom_size == size or bom_item.custom_size is None):
                results.append({
                    "sales_order": sales_order,
                    "line_item_no": line_item_no,
                    "size": size,
                    "item_type": bom_item.custom_item_type,
                    "item_code": bom_item.item_code,
                    "uom": bom_item.uom,
                    "per_unit_quantity": bom_item.qty,
                    "wo_quantity": wo_qty
                })

    return results


