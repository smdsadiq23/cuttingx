# Copyright (c) 2025, Cognitonx Logic India Private limited and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from frappe.utils import flt

class KnittingYarnRequest(Document):
    def before_submit(self):
        """Set status to 'Issued' automatically on submission."""
        self.status = "Issued"
        

@frappe.whitelist()
def get_yarns_from_work_order_bom(work_order):
    """
    Fetch yarn_code, bom_consumption, and yarn_count for all yarns in the BOM's custom_yarns_items.
    """
    if not work_order:
        return []

    production_item = frappe.db.get_value("Work Order", work_order, "production_item")
    if not production_item:
        return []

    bom = frappe.db.get_value("Item", production_item, "default_bom")
    if not bom:
        return []

    # Get all yarn items from BOM
    bom_yarns = frappe.db.get_all(
        "BOM Item",
        filters={
            "parent": bom,
            "parentfield": "custom_yarns_items"
        },
        fields=["item_code AS yarn_code", "custom_yarn_shade AS yarn_shade", "qty AS bom_consumption"]
    )

    if not bom_yarns:
        return []

    # Extract all yarn codes
    yarn_codes = [y.get("yarn_code") for y in bom_yarns if y.get("yarn_code")]

    # Fetch custom_yarn_count for all yarns in one query
    yarn_items = frappe.db.get_all(
        "Item",
        filters={"name": ["in", yarn_codes]},
        fields=["name AS yarn_code", "custom_yarn_count AS yarn_count"]
    )

    # Create a map: yarn_code → yarn_count
    yarn_count_map = {item["yarn_code"]: item.get("yarn_count") or "" for item in yarn_items}

    # Enrich BOM yarns with yarn_count
    result = []
    for yarn in bom_yarns:
        result.append({
            "yarn_code": yarn["yarn_code"],
            "yarn_shade": yarn["yarn_shade"],
            "bom_consumption": yarn["bom_consumption"],
            "yarn_count": yarn_count_map.get(yarn["yarn_code"], "")
        })

    return result