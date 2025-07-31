# Copyright (c) 2025, Cognitonx Logic India Private Limited and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document


class CutDocket(Document):
    def validate(self):
        if self.style:
            self.set_bom_no_from_style()
            self.set_panel_code_from_bom()
        self.calculate_fabric_requirement()
        self.calculate_fabric_requirement_against_marker()
        self.calculate_marker_efficiency()
        

    def set_bom_no_from_style(self):
        """Set bom_no from Item's default_bom using selected style"""
        if not self.style:
            frappe.throw(_("Please select a Style to fetch BOM."))

        item = frappe.get_doc("Item", self.style)

        if not item.default_bom:
            frappe.throw(_("Item '{0}' does not have a default BOM.").format(self.style))

        self.bom_no = item.default_bom
        

    def set_panel_code_from_bom(self):
        """Set panel_code from first BOM Item's custom_fg_link filtered by Fabrics"""
        if not self.bom_no:
            return

        bom = frappe.get_doc("BOM", self.bom_no)
        if not bom.items:
            frappe.msgprint(_("BOM {0} has no items").format(self.bom_no))
            return

        # Filter BOM Items by custom_item_type = "Fabrics"
        fabric_links = list({
            item.custom_fg_link for item in bom.items
            if item.custom_item_type == "Fabrics" and item.custom_fg_link
        })

        if fabric_links:
            self.panel_code = fabric_links[0]  # optional: auto-pick first
        else:
            self.panel_code = None
            

    def calculate_fabric_requirement(self):
        """
        Calculates total fabric requirement against BOM for the selected panel_code.
        Matches BOM Items with custom_panel_code == panel_code and custom_item_type == "Fabrics"
        Then multiplies matched BOM qty with planned_cut_quantity for size matches
        and stores the sum in fabric_requirement_against_bom
        """

        if not self.bom_no or not self.panel_code or not self.table_size_ratio_qty:
            self.fabric_requirement_against_bom = 0
            return

        try:
            bom = frappe.get_doc("BOM", self.bom_no)
        except frappe.DoesNotExistError:
            frappe.throw(_("BOM {0} not found").format(self.bom_no))

        # Step 1: Filter BOM items where custom_fg_link == panel_code and item type is Fabrics
        matching_bom_items = [
            item for item in bom.items
            if item.custom_fg_link == self.panel_code and item.custom_item_type == "Fabrics"
        ]

        if not matching_bom_items:
            frappe.msgprint(_("No matching BOM items found for panel code '{0}'").format(self.panel_code))
            self.fabric_requirement_against_bom = 0
            return

        total_qty = 0

        # Step 2: Match sizes and compute quantity
        for size_row in self.table_size_ratio_qty:
            matched_item = next((
                item for item in matching_bom_items
                if (item.custom_size or "").strip().lower() == (size_row.size or "").strip().lower()
            ), None)

            if matched_item:
                total_qty += matched_item.qty * size_row.planned_cut_quantity

        self.fabric_requirement_against_bom = total_qty


    def calculate_fabric_requirement_against_marker(self):
        """
        Sets fabric_requirement_against_marker = marker_length_meters * no_of_plies
        """
        if self.marker_length_meters and self.no_of_plies:
            self.fabric_requirement_against_marker = self.marker_length_meters * self.no_of_plies
        else:
            self.fabric_requirement_against_marker = 0
            
            
    def calculate_marker_efficiency(self):
        """
        Calculates marker_efficiency (%) =
        (fabric_requirement_against_bom / (marker_length_meters * marker_width_meters * no_of_plies)) * 100
        """
        try:
            numerator = self.fabric_requirement_against_bom
            denominator = (
                self.marker_length_meters or 0
            ) * (
                self.marker_width_meters or 0
            ) * (
                self.no_of_plies or 0
            )

            if denominator > 0:
                self.marker_efficiency = (numerator / denominator) * 100
            else:
                self.marker_efficiency = 0
        except Exception:
            self.marker_efficiency = 0
            
            
@frappe.whitelist()
def get_fabric_requirement(bom_no, panel_code, size_table):
    import json
    from frappe.utils import flt

    if not bom_no or not panel_code or not size_table:
        return 0

    try:
        bom = frappe.get_doc("BOM", bom_no)
    except frappe.DoesNotExistError:
        return 0

    size_rows = json.loads(size_table)

    matching_bom_items = [
        item for item in bom.items
        if item.custom_fg_link == panel_code and item.custom_item_type == "Fabrics"
    ]

    total_qty = 0
    for row in size_rows:
        size = (row.get("size") or "").strip().lower()
        planned_qty = flt(row.get("planned_cut_quantity"))

        matched_item = next((
            item for item in matching_bom_items
            if (item.custom_size or "").strip().lower() == size
        ), None)

        if matched_item:
            total_qty += matched_item.qty * planned_qty

    return total_qty


@frappe.whitelist()
def get_sales_orders_by_item(doctype, txt, searchfield, start, page_len, filters):
    style = filters.get("style")
    if not style:
        return []

    return frappe.db.sql("""
        SELECT DISTINCT so.name
        FROM `tabSales Order` so
        JOIN `tabSales Order Item` soi ON soi.parent = so.name
        WHERE soi.item_code = %s
        AND so.docstatus = 1
        AND so.status != 'Closed'
        AND so.name LIKE %s
        ORDER BY so.name ASC
        LIMIT %s OFFSET %s
    """, (style, f"%{txt}%", page_len, start))


@frappe.whitelist()
def get_work_orders_by_so_and_lineitem(doctype, txt, searchfield, start, page_len, filters):
    sales_order = filters.get("sales_order")
    line_item = filters.get("line_item")

    return frappe.db.sql("""
        SELECT DISTINCT wo.name
        FROM `tabWork Order` wo
        JOIN `tabWork Order Line Item` woli ON woli.parent = wo.name
        WHERE wo.docstatus < 2
        AND wo.sales_order = %s
        AND woli.line_item_no = %s
        AND wo.name LIKE %s
        ORDER BY wo.name DESC
        LIMIT %s OFFSET %s
    """, (sales_order, line_item, f"%{txt}%", page_len, start))


@frappe.whitelist()
def get_already_cut_quantity(work_order):
    if not work_order:
        return 0

    total = frappe.db.sql("""
        SELECT SUM(already_cut)
        FROM `tabCut Docket Item`
        WHERE ref_work_order = %s
    """, (work_order,), as_dict=True)

    return total[0]["SUM(already_cut)"] or 0



