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
def get_bom_consumption_for_yarn(yarn_code):
    """
    Fetch bom_consumption (qty) from BOM Item where:
    - item_code = yarn_code
    - parentfield = 'custom_yarns_items'
    
    Returns qty as float. Assumes at most one match exists.
    """
    if not yarn_code:
        return 0.0

    result = frappe.db.get_value(
        "BOM Item",
        filters={
            "item_code": yarn_code,
            "parentfield": "custom_yarns_items"
        },
        fieldname="qty"
    )
    return flt(result or 0.0)