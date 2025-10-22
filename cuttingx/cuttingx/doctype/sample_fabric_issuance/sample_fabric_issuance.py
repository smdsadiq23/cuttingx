# Copyright (c) 2025, Cognitonx Logic India Private limited and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class SampleFabricIssuance(Document):
	pass


@frappe.whitelist()
def get_available_sample_requests():
    """
    Returns Sample Fabric Requests that are submitted and NOT yet issued.
    """
    # Get all submitted Sample Fabric Requests
    all_requests = frappe.get_all("Sample Fabric Request", filters={
        "docstatus": 1
    }, pluck="name")

    # Get requests already used in Sample Fabric Issuance (Draft or Submitted)
    issued_requests = frappe.get_all("Sample Fabric Issuance", filters={
        "docstatus": ["!=", 2]  # exclude cancelled
    }, pluck="request_id")

    available = list(set(all_requests) - set(issued_requests))
    return available


@frappe.whitelist()
def get_grns_for_ocn_and_colour(ocn, colour):
    """
    Returns list of GRN names (submitted) where:
    - GRN.ocn = ocn
    - At least one GRN Item has color = colour
    """
    if not (ocn and colour):
        return []

    # Get GRN items matching colour
    grn_names = frappe.get_all(
        "Goods Receipt Item",
        filters={
            "color": colour,
            "parenttype": "Goods Receipt Note"
        },
        fields=["parent"],
        distinct=True
    )
    grn_names = [g.parent for g in grn_names]

    if not grn_names:
        return []

    # Now filter by OCN and docstatus
    valid_grns = frappe.get_all(
        "Goods Receipt Note",
        filters={
            "name": ["in", grn_names],
            "ocn": ocn,
            "docstatus": 1
        },
        pluck="name"
    )

    return valid_grns


@frappe.whitelist()
def get_rolls_for_grn_and_colour(grn, colour):
    """
    Returns list of roll_no from GRN items matching colour.
    """
    if not (grn and colour):
        return []

    rolls = frappe.get_all(
        "Goods Receipt Item",
        filters={
            "parent": grn,
            "color": colour,
            "roll_no": ["is", "set"]
        },
        pluck="roll_no"
    )

    return list(set([r for r in rolls if r]))