# Copyright (c) 2025, Cognitonx Logic India Private limited and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class LineIn(Document):
	pass


@frappe.whitelist()
def get_bundles_from_bundle_creation(bundle_creation):
    """
    Fetch bundles with work_order, sales_order, line_item_no from Bundle Configuration Item
    """
    if not bundle_creation:
        return []

    # Confirm it exists
    if not frappe.db.exists("Bundle Creation", bundle_creation):
        frappe.throw(f"Bundle Creation {bundle_creation} not found")

    # Step 1: Get all Bundle Details
    bundle_details = frappe.get_all(
        "Bundle Details",
        filters={"parent": bundle_creation, "parenttype": "Bundle Creation"},
        fields=[
            "name as bundle_detail_name",
            "bundle_id",
            "unitsbundle",
            "barcode_image",
            "qrcode_image",
            "parent_item_id"
        ],
        order_by="idx"
    )

    # Step 2: Map parent_item_id → config item data
    config_items = {}
    if bundle_details:
        # Get all config items in one query
        config_data = frappe.get_all(
            "Bundle Creation Item",
            filters={"parent": bundle_creation},
            fields=["name", "work_order", "sales_order", "line_item_no", "size"]
        )
        for item in config_data:
            config_items[item.name] = {
                "work_order": item.work_order,
                "sales_order": item.sales_order,
                "line_item_no": item.line_item_no,
                "size": item.size
            }

    # Step 3: Build result with mapped data
    result = []
    for bd in bundle_details:
        config = config_items.get(bd.parent_item_id)
        if not config:
            frappe.msgprint(f"⚠️ No matching configuration item found for parent_item_id: {bd.parent_item_id}")
            continue

        result.append({
            "work_order": config["work_order"],
            "sales_order": config["sales_order"],
            "line_item_no": config["line_item_no"],
            "size": config["size"],
			"bundle_id": bd.bundle_id,
            "unitsbundle": bd.unitsbundle,
            "bundle_detail_name": bd.bundle_detail_name
        })

    # ✅ SORT: work_order → sales_order → line_item_no → bundle_id
    result.sort(
        key=lambda x: (
            x["work_order"] or "",
            x["sales_order"] or "",
            x["line_item_no"] or ""
        )
    )        

    return result