# Copyright (c) 2025, Cognitonx Logic India Private limited and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document


class SampleFabricRequest(Document):
	def before_insert(self):
		if not self.requested_by:
			self.requested_by = frappe.session.user

	def validate(doc, method=None):
		# 1. Ensure item_code belongs to the selected Sales Order (OCN)
		if doc.ocn and doc.item_code:
			items_in_so = frappe.get_all(
				"Sales Order Item",
				filters={"parent": doc.ocn},
				pluck="item_code"
			)
			if doc.item_code not in items_in_so:
				frappe.throw(
					_("Item {0} is not part of Sales Order {1}").format(
						frappe.bold(doc.item_code), frappe.bold(doc.ocn)
					)
				)

		## Multiple Request may be raised for same OCN-Item Code-Colour hence removing below validation
		# # 2. Prevent duplicate Sample Fabric Request for (OCN, Item Code, Colour)
		# if doc.ocn and doc.item_code and doc.colour:
		# 	filters = {
		# 		"ocn": doc.ocn,
		# 		"item_code": doc.item_code,
		# 		"colour": doc.colour,
		# 		"docstatus": ["!=", 2]  # exclude cancelled
		# 	}
		# 	if doc.name:  # avoid matching self when editing
		# 		filters["name"] = ["!=", doc.name]

		# 	existing = frappe.db.exists("Sample Fabric Request", filters)
		# 	if existing:
		# 		frappe.throw(
		# 			_("A Sample Fabric Request already exists for OCN {0}, Item {1}, and Colour {2}.<br><br>"
		# 			"Duplicate request: <a href='/app/sample-fabric-request/{3}'>{3}</a>")
		# 			.format(
		# 				frappe.bold(doc.ocn),
		# 				frappe.bold(doc.item_code),
		# 				frappe.bold(doc.colour),
		# 				existing
		# 			),
		# 			title=_("Duplicate Entry")
		# 		)


@frappe.whitelist()
def get_items_from_sales_order(sales_order):
    """
    Returns list of item codes from the given Sales Order.
    """
    if not sales_order:
        return []

    # Ensure user has read access to the Sales Order
    if not frappe.has_permission("Sales Order", doc=sales_order):
        frappe.throw(_("Not permitted to access Sales Order {0}").format(sales_order))

    items = frappe.get_all(
        "Sales Order Item",
        filters={"parent": sales_order},
        fields=["item_code"],
        pluck="item_code"
    )
    return items