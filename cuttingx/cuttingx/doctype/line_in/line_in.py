# Copyright (c) 2025, Cognitonx Logic India Private limited and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class LineIn(Document):
    pass


@frappe.whitelist()
def get_bundle_details(bundle_id):
    """
    Fetch minimal bundle details:
    - work_order, sales_order, line_item_no from Bundle Creation Item
    - size, line_in_quantity from Bundle Details
    """
    # Find the bundle in table_bundle_details
    bundle_detail = frappe.db.get_value(
        "Bundle Details",
        {"bundle_id": bundle_id},
        ["parent_item_id", "size", "unitsbundle"],
        as_dict=True
    )

    if not bundle_detail:
        return None

    # Get Bundle Creation Item (Bundle Configuration Item)
    config_item = frappe.db.get_value(
        "Bundle Creation Item",
        bundle_detail.parent_item_id,
        ["work_order", "sales_order", "line_item_no"],
        as_dict=True
    )

    if not config_item:
        return None

    return {
        "work_order": config_item.work_order,
        "sales_order": config_item.sales_order,
        "line_item_no": config_item.line_item_no,
        "size": bundle_detail.size,
        "line_in_quantity": bundle_detail.unitsbundle
    }