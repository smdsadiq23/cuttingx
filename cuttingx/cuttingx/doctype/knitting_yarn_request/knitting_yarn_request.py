# Copyright (c) 2025, Cognitonx Logic India Private limited and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import flt

class KnittingYarnRequest(Document):
    def before_submit(doc):
        # 1. Role validation: Only Yarn Approvers can submit
        if "Yarn Approver" not in frappe.get_roles(frappe.session.user):
            frappe.throw(_("Only users with the 'Yarn Approver' role can submit this document."))

        # 2. Child table validation: yarn_issued must be > 0 in every row
        if not doc.table_yarn_shade_distribution:
            frappe.throw(_("Please add at least one item in the Yarn Shade Distribution table."))

        for row in doc.table_yarn_shade_distribution:
            if not row.yarn_issued or flt(row.yarn_issued) <= 0:
                frappe.throw(
                    _("Row #{0}: Yarn Issued must be greater than 0 for Yarn Code {1}.").format(
                        row.idx, row.yarn_code or _("(not specified)")
                    )
                )

        # 3. All validations passed → safe to update status
        doc.status = "Issued"
        

@frappe.whitelist()
def get_yarns_from_work_order_bom(work_order):
    """
    Fetch yarn_code, yarn_shade_code, yarn_shade (from Colour Master),
    bom_consumption, and yarn_count from the BOM's custom_yarns_items.
    """
    if not work_order:
        return []

    # Get BOM from Work Order → Production Item → Default BOM
    production_item = frappe.db.get_value("Work Order", work_order, "production_item")
    if not production_item:
        return []

    bom = frappe.db.get_value("Item", production_item, "default_bom")
    if not bom:
        return []

    # Fetch yarn entries from BOM's custom_yarns_items
    bom_yarns = frappe.db.get_all(
        "BOM Item",
        filters={"parent": bom, "parentfield": "custom_yarns_items"},
        fields=["item_code AS yarn_code", "custom_yarn_shade AS yarn_shade_code", "qty AS bom_consumption"],
    )

    if not bom_yarns:
        return []

    # Unique codes for batch fetching
    yarn_codes = list({y["yarn_code"] for y in bom_yarns if y.get("yarn_code")})
    shade_codes = list({y["yarn_shade_code"] for y in bom_yarns if y.get("yarn_shade_code")})

    # Batch-fetch yarn counts
    yarn_count_map = {
        item.name: item.custom_yarn_count or ""
        for item in frappe.db.get_all(
            "Item",
            filters={"name": ["in", yarn_codes]},
            fields=["name", "custom_yarn_count"]
        )
    }

    # Batch-fetch colour names
    colour_name_map = {
        colour.name: colour.colour_name or ""
        for colour in frappe.db.get_all(
            "Colour Master",
            filters={"name": ["in", shade_codes]},
            fields=["name", "colour_name"]
        )
    }

    # Build result
    return [
        {
            "yarn_code": y["yarn_code"],
            "yarn_shade_code": y.get("yarn_shade_code") or "",
            "yarn_shade": colour_name_map.get(y.get("yarn_shade_code") or "", ""),
            "bom_consumption": y["bom_consumption"],
            "yarn_count": yarn_count_map.get(y["yarn_code"], ""),
        }
        for y in bom_yarns
    ]