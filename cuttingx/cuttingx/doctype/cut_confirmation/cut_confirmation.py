# Copyright (c) 2025, CognitionX Logic India Private limited and contributors
# For license information, please see license.txt

# import frappe
from frappe import _
from frappe.model.document import Document


class CutConfirmation(Document):
    pass


def validate(doc, method):
    """
    Called on validate of Cut Confirmation
    Recalculate all child rows
    """
    for item in doc.table_urpz:
        item.calculate_balance_to_confirm()  # Calls method from child class
        item.calculate_total_reject()  # Calls method from child class
