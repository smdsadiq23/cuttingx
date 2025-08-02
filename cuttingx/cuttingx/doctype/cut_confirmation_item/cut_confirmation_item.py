# Copyright (c) 2025, CognitionX Logic India Private limited and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document

class CutConfirmationItem(Document):
    def validate(self):
        self.calculate_balance_to_confirm()
        self.calculate_total_reject()

    def calculate_balance_to_confirm(self):
        """balance_to_confirm = planned_quantity - confirmed_quantity"""
        planned = flt(self.planned_quantity)
        confirmed = flt(self.confirmed_quantity)
        self.balance_to_confirm = planned - confirmed

    def calculate_total_reject(self):
        """total_reject = full_panel_reject + other_reject"""
        full_panel = flt(self.full_panel_reject)
        other = flt(self.other_reject)
        self.total_reject = full_panel + other


# Utility function for safe float conversion
def flt(value, precision=2):
    return round(float(value or 0), precision)