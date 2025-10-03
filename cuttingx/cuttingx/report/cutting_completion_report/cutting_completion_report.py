# Copyright (c) 2025, Cognitonx Logic India Private limited and contributors
# For license information, please see license.txt

import frappe
from frappe import _


def execute(filters=None):
    columns = get_columns()
    data = get_data(filters)
    return columns, data

def get_columns():
    return [
        {
            "label": _("OCN"),
            "fieldname": "ocn",
            "fieldtype": "Link",
            "options": "Sales Order",
            "width": 120
        },
        {
            "label": _("Style"),
            "fieldname": "style",
            "fieldtype": "Data",
            "width": 120
        },
        {
            "label": _("Colour"),
            "fieldname": "colour",
            "fieldtype": "Data",
            "width": 120
        },
        {
            "label": _("Order Qty"),
            "fieldname": "order_qty",
            "fieldtype": "Int",
            "width": 100
        },
        {
            "label": _("Fabric Ordered"),
            "fieldname": "fabric_ordered",
            "fieldtype": "Float",
            "width": 120
        },
        {
            "label": _("Fabric Issued"),
            "fieldname": "fabric_issued",
            "fieldtype": "Float",
            "width": 140
        },
        {
            "label": _("Folding"),
            "fieldname": "folding",
            "fieldtype": "Small Text",
            "width": 120
        },
        {
            "label": _("End Bit"),
            "fieldname": "end_bit",
            "fieldtype": "Small Text",
            "width": 120
        },
        {
            "label": _("File Consumption"),
            "fieldname": "file_consumption",
            "fieldtype": "Float",
            "width": 140
        },
        {
            "label": _("Actual Consumption"),
            "fieldname": "actual_consumption",
            "fieldtype": "Float",
            "width": 160
        },
        {
            "label": _("Can Cut Qty"),
            "fieldname": "can_cut_qty",
            "fieldtype": "Float",
            "width": 100
        },
        {
            "label": _("Cut Qty Actual"),
            "fieldname": "cut_qty_actual",
            "fieldtype": "Float",
            "width": 120
        },
        {
            "label": _("Difference"),
            "fieldname": "difference",
            "fieldtype": "Float",
            "width": 100
        },
        {
            "label": _("Status"),
            "fieldname": "status",
            "fieldtype": "Data",
            "width": 120
        },
        {
            "label": _("Approved By"),
            "fieldname": "custom_approved_by",
            "fieldtype": "Link",
            "options": "User",
            "width": 140
        },
        {
            "label": _("Approved On"),
            "fieldname": "custom_approved_on",
            "fieldtype": "Datetime",
            "width": 160
        }        
    ]

def get_data(filters):
    conditions = ""
    if filters.get("from_date"):
        conditions += " AND so.delivery_date >= %(from_date)s"
    if filters.get("to_date"):
        conditions += " AND so.delivery_date <= %(to_date)s"

    query = """
        SELECT 
            *,
            CASE WHEN rn = 1 THEN 1 ELSE 0 END AS is_first_row
        FROM (
            SELECT
                so.name AS ocn,
                item.custom_style_master AS style,
                sod.custom_color AS colour,
                SUM(sod.custom_order_qty) AS order_qty,  -- Aggregated
                so.delivery_date,

                cc.fabric_ordered,
                cc.fabric_issued,
                cc.folding,
                cc.end_bit,
                cc.file_consumption,
                cc.actual_consumption,
                cc.name AS can_cut_name,

                CASE 
                    WHEN cc.actual_consumption > 0 THEN (cc.fabric_issued / cc.actual_consumption)
                    ELSE 0
                END AS can_cut_qty,

                COALESCE((
                    SELECT SUM(cci.confirmed_quantity)
                    FROM `tabCut Confirmation Item` cci
                    INNER JOIN `tabCut Confirmation` con ON con.name = cci.parent
                    INNER JOIN `tabCut Docket` cd ON cd.name = con.cut_po_number
                    WHERE cci.sales_order = so.name
                    AND cd.color = sod.custom_color
                    AND cci.docstatus = 1
                ), 0) AS cut_qty_actual,

                (COALESCE((
                    SELECT SUM(cci.confirmed_quantity)
                    FROM `tabCut Confirmation Item` cci
                    INNER JOIN `tabCut Confirmation` con ON con.name = cci.parent
                    INNER JOIN `tabCut Docket` cd ON cd.name = con.cut_po_number
                    WHERE cci.sales_order = so.name
                    AND cd.color = sod.custom_color
                    AND cci.docstatus = 1
                ), 0) - SUM(sod.custom_order_qty)) AS difference,

                COALESCE(so.custom_consumption_status, 'Pending for Approval') AS status,

                so.custom_approved_by,
                so.custom_approved_on,                

                ROW_NUMBER() OVER (PARTITION BY so.name ORDER BY sod.custom_color) AS rn

            FROM `tabSales Order` so
            INNER JOIN `tabSales Order Item` sod ON sod.parent = so.name
            INNER JOIN `tabItem` item ON item.name = sod.item_code
            LEFT JOIN `tabCan Cut` cc 
                ON cc.sales_order = so.name 
                AND cc.colour = sod.custom_color
            WHERE so.docstatus = 1
            {conditions}

            GROUP BY so.name, sod.custom_color, item.custom_style_master, cc.name
            ORDER BY so.delivery_date, so.name, sod.custom_color
        ) sub_query
        ORDER BY delivery_date, ocn, rn
    """.format(conditions=conditions)

    data = frappe.db.sql(query, filters, as_dict=1)
    return data