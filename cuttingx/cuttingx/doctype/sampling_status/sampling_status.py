# Copyright (c) 2025, Cognitonx Logic India Private limited and contributors
# For license information, please see license.txt

import frappe
from frappe.utils import flt
from frappe.model.document import Document


class SamplingStatus(Document):
	def before_save(self):
		total = sum(flt(row.weight) for row in self.table_sampling_status_consumption)
		self.total_consumption_weight = total

		for row in self.table_sampling_status_consumption:
			row.percentage = (flt(row.weight) / total * 100) if total else 0