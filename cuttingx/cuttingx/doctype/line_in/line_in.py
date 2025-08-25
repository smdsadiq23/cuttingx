# Copyright (c) 2025, Cognitonx Logic India Private limited and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class LineIn(Document):
    pass


@frappe.whitelist()
def get_bundles_from_bundle_creation(bundle_creation):
    """
    Fetch bundles with work_order, sales_order, line_item_no, size from Bundle Creation Item
    via parent_item_id link.
    """
    if not bundle_creation:
        return []

    if not frappe.db.exists("Bundle Creation", bundle_creation):
        frappe.throw(f"Bundle Creation {bundle_creation} not found")

    # Get all Bundle Details
    bundle_details = frappe.get_all("Bundle Details",
        filters={"parent": bundle_creation, "parenttype": "Bundle Creation"},
        fields=["bundle_id", "unitsbundle", "parent_item_id"],
        order_by="idx"
    )

    # Map parent_item_id → config item data
    config_items = {}
    if bundle_details:
        for item in frappe.get_all("Bundle Creation Item",
            filters={"parent": bundle_creation},
            fields=["name", "work_order", "sales_order", "line_item_no", "size"]
        ):
            config_items[item.name] = {
                "work_order": item.work_order,
                "sales_order": item.sales_order,
                "line_item_no": item.line_item_no,
                "size": item.size
            }

    # Build result
    result = []
    for bd in bundle_details:
        config = config_items.get(bd.parent_item_id)
        if not config:
            continue

        result.append({
            "work_order": config["work_order"],
            "sales_order": config["sales_order"],
            "line_item_no": config["line_item_no"],
            "size": config["size"],
            "bundle_id": bd.bundle_id,
            "unitsbundle": bd.unitsbundle
        })

    # Sort: work_order → sales_order → line_item_no
    result.sort(key=lambda x: (
        x["work_order"] or "",
        x["sales_order"] or "",
        x["line_item_no"] or ""
    ))

    return result


@frappe.whitelist()
def get_unused_bundle_creations(doctype, txt, searchfield, start, page_len, filters):
    """
    Return Bundle Creation docs that:
    - Are SUBMITTED (docstatus = 1)
    - Not used in any Line In (draft or submitted)
    """
    # Get all Bundle Creation docs already used in any Line In
    used_bundle_orders = frappe.db.sql_list("""
        SELECT DISTINCT bundle_order_no
        FROM `tabLine In`
        WHERE bundle_order_no IS NOT NULL
    """)
    # No need to check docstatus < 2 — we want to exclude ALL Line In entries

    conditions = ["bc.docstatus = 1"]  # Only submitted Bundle Creation
    values = {
        "txt": f"%{txt}%",
        "start": start,
        "page_len": page_len
    }

    if used_bundle_orders:
        conditions.append("bc.name NOT IN %(used)s")
        values["used"] = used_bundle_orders

    condition_str = " AND ".join(conditions)

    return frappe.db.sql("""
        SELECT bc.name
        FROM `tabBundle Creation` bc
        WHERE {condition}
          AND bc.name LIKE %(txt)s
        ORDER BY bc.modified DESC
        LIMIT %(page_len)s OFFSET %(start)s
    """.format(condition=condition_str), values)