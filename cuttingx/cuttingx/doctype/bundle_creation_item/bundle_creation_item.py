# Copyright (c) 2025, Cognitonx Logic India Private limited and contributors
# For license information, please see license.txt

# -*- coding: utf-8 -*-
import frappe
from frappe import _
from frappe.model.document import Document
import math


class BundleCreationItem(Document):
    def validate(self):
        self.validate_planned_quantity()
        self.validate_unitsbundle()
        self.calculate_no_of_bundles()

    def validate_planned_quantity(self):
        if self.planned_quantity < 0:
            frappe.throw(_("Planned Quantity cannot be negative"))

    def validate_unitsbundle(self):
        if self.unitsbundle <= 0:
            frappe.throw(_("Units per Bundle must be greater than 0"))

    def calculate_no_of_bundles(self):
        qty = self.planned_quantity or 0
        units = self.unitsbundle or 1  # Avoid division by zero

        # Ceiling division: 201 / 40 = 5.025 → 6
        self.no_of_bundles = math.ceil(qty / units)