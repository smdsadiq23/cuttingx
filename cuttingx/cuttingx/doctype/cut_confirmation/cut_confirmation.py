# Copyright (c) 2025, CognitionX Logic India Private limited and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import flt
import json


class CutConfirmation(Document):
    def autoname(self):
        """
        Custom naming: CC-{First_Work_Order}-0001
        Example: CC-WO-00123-0001
        """
        work_order = None

        # Get first valid Work Order from child table `table_cut_confirmation_item`
        if self.table_cut_confirmation_item:
            for row in self.table_cut_confirmation_item:
                if row.work_order:
                    work_order = row.work_order
                    break

        if not work_order:
            frappe.throw(_("At least one Work Order must be selected in Cut Confirmation Items to generate document name."))

        # Sanitize Work Order name (replace problematic characters like /, \, spaces)
        wo_clean = str(work_order).replace("/", "-").replace("\\", "-").replace(" ", "-")

        # Generate name using Frappe's auto-incrementing naming
        prefix = f"CC-{wo_clean}"
        self.name = frappe.model.naming.make_autoname(prefix + "-.####")


def validate(doc, method):
    """
    Validate:
    1. Recalculate derived fields (balance_to_confirm, total_reject)
    2. Cut Docket and Lay Record must be selected together
    3. (Cut Docket + Lay Record) combination must be unique
    4. Total confirmed quantity across all Cut Confirmations 
       must not exceed 120% of Cut Docket's planned quantity 
       for each (Work Order, Sales Order, Line Item No, Size)
    """
    # 1. Recalculate derived fields (safe, no validation)
    for item in doc.table_cut_confirmation_item:
        item.calculate_balance_to_confirm()
        item.calculate_total_reject()

    # 2. Ensure Cut Docket and Lay Record are selected together
    if doc.cut_po_number and not doc.lay_record:
        frappe.throw(_("Please select a Lay Record for the selected Cut Docket."))
    if doc.lay_record and not doc.cut_po_number:
        frappe.throw(_("Lay Record cannot be selected without a Cut Docket."))

    # 3. Ensure (Cut Docket + Lay Record) combination is unique
    if doc.cut_po_number and doc.lay_record:
        existing = frappe.db.exists(
            "Cut Confirmation",
            {
                "cut_po_number": doc.cut_po_number,
                "lay_record": doc.lay_record,
                "name": ("!=", doc.name),
                "docstatus": ("!=", 2)  # Exclude cancelled
            }
        )
        if existing:
            frappe.throw(
                _("The combination of Cut Docket {0} and Lay Record {1} has already been used in "
                  "<a href='/app/cut-confirmation/{2}'>{2}</a>. "
                  "Each (Cut Docket + Lay Record) pair can only be confirmed once.").format(
                    frappe.bold(doc.cut_po_number),
                    frappe.bold(doc.lay_record),
                    existing
                ),
                title=_("Duplicate Cut Docket + Lay Record")
            )

    # 4. 🔑 Ensure at least one confirmed quantity > 0
    validate_at_least_one_confirmed(doc)  

    # 5. Validate total confirmed ≤ 120% of planned (aggregate across all Cut Confirmations)
    if doc.cut_po_number:
        validate_total_confirmed_against_docket(doc)


def validate_at_least_one_confirmed(doc):
    """Ensure at least one row in Cut Confirmation Item has confirmed_quantity > 0."""
    has_confirmed = any(
        flt(row.confirmed_quantity) > 0 for row in doc.table_cut_confirmation_item
    )
    if not has_confirmed:
        frappe.throw(
            _("At least one row in 'Cut Confirmation Item' must have a Confirmed Quantity greater than zero.")
        )


def validate_total_confirmed_against_docket(doc):
    """
    1. Validate total confirmed ≤ 120% of planned
    2. Set accurate balance_to_confirm = planned − (total confirmed from OTHER Cut Confirmations)
    """
    if not doc.cut_po_number:
        return

    # Fetch Cut Docket
    try:
        cut_docket = frappe.get_doc("Cut Docket", doc.cut_po_number)
    except frappe.DoesNotExistError:
        frappe.throw(_("Cut Docket {0} not found").format(doc.cut_po_number))

    # Build map: key → planned quantity
    docket_plan = {}
    for row in cut_docket.table_size_ratio_qty:
        if row.ref_work_order and row.sales_order and row.line_item_no and row.size:
            key = (
                row.ref_work_order.strip(),
                row.sales_order.strip(),
                str(row.line_item_no).strip(),
                row.size.strip().lower()
            )
            docket_plan[key] = flt(row.planned_cut_quantity)

    # Get confirmed totals from OTHER Cut Confirmations (excluding current doc)
    other_confirmed = {}
    other_data = frappe.db.sql("""
        SELECT 
            cci.work_order,
            cci.sales_order,
            cci.line_item_no,
            cci.size,
            SUM(cci.confirmed_quantity) as total_confirmed
        FROM `tabCut Confirmation Item` cci
        INNER JOIN `tabCut Confirmation` cc ON cci.parent = cc.name
        WHERE 
            cc.cut_po_number = %s
            AND cc.docstatus != 2
            AND cc.name != %s
        GROUP BY 
            cci.work_order, 
            cci.sales_order, 
            cci.line_item_no, 
            cci.size
    """, (doc.cut_po_number, doc.name), as_dict=True)

    for row in other_data:
        key = (
            (row.work_order or "").strip(),
            (row.sales_order or "").strip(),
            str(row.line_item_no or "").strip(),
            (row.size or "").strip().lower()
        )
        if all(key):
            other_confirmed[key] = flt(row.total_confirmed)

    # Now process current document's items
    for item in doc.table_cut_confirmation_item:
        if not (item.work_order and item.sales_order and item.line_item_no and item.size):
            # Skip invalid rows
            item.balance_to_confirm = 0
            continue

        key = (
            item.work_order.strip(),
            item.sales_order.strip(),
            str(item.line_item_no).strip(),
            item.size.strip().lower()
        )

        # 1. Check if key exists in Cut Docket
        if key not in docket_plan:
            frappe.throw(
                _("Row with Work Order '{0}', Sales Order '{1}', Line Item No '{2}', Size '{3}' "
                  "is not present in Cut Docket {4}. Please verify.")
                .format(
                    key[0], key[1], key[2], key[3], doc.cut_po_number
                )
            )

        planned = docket_plan[key]
        confirmed_elsewhere = other_confirmed.get(key, 0)
        current_confirmed = flt(item.confirmed_quantity)

        # 2. Total confirmed including current doc
        total_confirmed = confirmed_elsewhere + current_confirmed

         # --- BEGIN: 120% Validation (currently DISABLED) ---
        # max_allowed = planned * 1.2

        # if total_confirmed > max_allowed:
        #     frappe.throw(
        #         _("Total confirmed quantity for:<br>"
        #           "<b>WO:</b> {0}, <b>SO:</b> {1}, <b>Line Item:</b> {2}, <b>Size:</b> {3}<br>"
        #           "is <b>{4}</b> including previous Cut Confiramtions, which exceeds 120% of planned quantity ({5} × 1.2 = {6}).")
        #         .format(
        #             key[0], key[1], key[2], key[3],
        #             flt(total_confirmed, 2),
        #             planned,
        #             flt(max_allowed, 2)
        #         )
        #     )

        # 3. ✅ Set accurate balance_to_confirm = planned − total_confirmed (including current doc)          
        balance = planned - total_confirmed
        item.balance_to_confirm = max(0, flt(balance))

        # 4. Optional: Also set total_reject (if needed)
        item.total_reject = flt(item.full_panel_reject or 0) + flt(item.other_reject or 0)      


@frappe.whitelist()
def get_unused_cut_dockets(doctype, txt, searchfield, start, page_len, filters, as_dict=False):
    """
    Return Cut Dockets that:
    - Are submitted (docstatus = 1)
    - Have at least one Cutting Lay Record (cut_kanban_no = Cut Docket)
    - And have at least one Lay Record that is NOT used in any other non-cancelled Cut Confirmation
    - Match the search text
    """
    current_doc = filters.get("current_doc") or ""

    # Main query: Find Cut Dockets with unused Lay Records
    query = """
        SELECT DISTINCT cd.name
        FROM `tabCut Docket` cd
        WHERE cd.docstatus = 1
          AND cd.name LIKE %(txt)s
          AND EXISTS (
              -- At least one Lay Record exists for this Cut Docket
              SELECT 1
              FROM `tabCutting Lay Record` clr
              WHERE clr.cut_kanban_no = cd.name
                AND clr.docstatus != 2
                AND NOT EXISTS (
                    -- And that Lay Record is NOT used in any other Cut Confirmation
                    SELECT 1
                    FROM `tabCut Confirmation` cc
                    WHERE cc.cut_po_number = cd.name
                      AND cc.lay_record = clr.name
                      AND cc.name != %(current_doc)s
                      AND cc.docstatus != 2
                )
          )
        ORDER BY cd.name
        LIMIT %(page_len)s OFFSET %(start)s
    """

    params = {
        "txt": f"%{txt}%",
        "current_doc": current_doc,
        "page_len": page_len,
        "start": start
    }

    results = frappe.db.sql(query, params)
    return [[row[0]] for row in results]


@frappe.whitelist()
def get_eligible_lay_records(doctype, txt, searchfield, start, page_len, filters):
    """
    Frappe-compatible search query for Lay Record dropdown in Cut Confirmation.
    
    Filters Lay Records by:
      - cut_kanban_no = filters.cut_docket
      - Not used in any other Cut Confirmation
    """
    # Parse filters (passed as a JSON string or dict)
    if isinstance(filters, str):
        filters = json.loads(filters)
    
    cut_docket = filters.get("cut_docket")
    current_doc = filters.get("current_doc") or ""

    if not cut_docket:
        return []

    # Get Lay Records already used with this Cut Docket (excluding current doc)
    used_lay_records = frappe.db.sql("""
        SELECT lay_record
        FROM `tabCut Confirmation`
        WHERE cut_po_number = %s
          AND lay_record IS NOT NULL
          AND docstatus != 2
          AND name != %s
    """, (cut_docket, current_doc), as_dict=False)

    used_set = {row[0] for row in used_lay_records if row[0]}

    # Get eligible Lay Records (with optional search text match)
    query = """
        SELECT name
        FROM `tabCutting Lay Record`
        WHERE cut_kanban_no = %s
          AND docstatus != 2
          AND name LIKE %s
        ORDER BY name
        LIMIT %s OFFSET %s
    """

    lay_records = frappe.db.sql(
        query,
        (cut_docket, f"%{txt}%", int(page_len), int(start)),
        as_dict=False
    )

    # Filter out used ones
    eligible = [
        [row[0]]  # Frappe expects list of lists or list of dicts
        for row in lay_records
        if row[0] not in used_set
    ]

    return eligible


@frappe.whitelist()
def get_items_from_cut_docket(cut_po_number):
    """
    Fetch data from Cut Docket Item child table.
    Set confirmed_quantity = planned - already confirmed elsewhere.
    """
    if not cut_po_number:
        return []

    try:
        docket_doc = frappe.get_doc("Cut Docket", cut_po_number)
    except frappe.DoesNotExistError:
        frappe.throw(_("Cut Docket {0} not found").format(cut_po_number))

    # Build key → planned map from docket
    docket_plan = {}
    result_template = []
    for item in docket_doc.get("table_size_ratio_qty") or []:
        if item.ref_work_order and item.size:
            key = (
                (item.ref_work_order or "").strip(),
                (item.sales_order or "").strip(),
                str(item.line_item_no or "").strip(),
                (item.size or "").strip().lower()
            )
            if all(key):
                planned = flt(item.planned_cut_quantity)
                docket_plan[key] = planned
                result_template.append({
                    "work_order": item.ref_work_order,
                    "sales_order": item.sales_order,
                    "line_item_no": item.line_item_no,
                    "size": item.size,
                    "planned_quantity": planned,
                    "key": key
                })

    if not result_template:
        return []

    # Fetch ALL confirmed quantities for this Cut Docket (from other Cut Confirmations)
    confirmed_rows = frappe.db.sql("""
        SELECT 
            cci.work_order,
            cci.sales_order,
            cci.line_item_no,
            cci.size,
            SUM(cci.confirmed_quantity) AS total_confirmed
        FROM `tabCut Confirmation Item` cci
        INNER JOIN `tabCut Confirmation` cc ON cci.parent = cc.name
        WHERE 
            cc.cut_po_number = %s
            AND cc.docstatus != 2
        GROUP BY 
            cci.work_order, 
            cci.sales_order, 
            cci.line_item_no, 
            cci.size
    """, (cut_po_number,), as_dict=True)

    # Build confirmed map
    confirmed_map = {}
    for row in confirmed_rows:
        key = (
            (row.work_order or "").strip(),
            (row.sales_order or "").strip(),
            str(row.line_item_no or "").strip(),
            (row.size or "").strip().lower()
        )
        if all(key):
            confirmed_map[key] = flt(row.total_confirmed)

    # Build final result
    result = []
    for item in result_template:
        key = item["key"]
        planned = item["planned_quantity"]
        already_confirmed = confirmed_map.get(key, 0)
        remaining = max(0, planned - already_confirmed)

        result.append({
            "work_order": item["work_order"],
            "sales_order": item["sales_order"],
            "line_item_no": item["line_item_no"],
            "size": item["size"],
            "planned_quantity": planned,
            "confirmed_quantity": remaining 
        })

    return result


# @frappe.whitelist()
# def get_sales_orders_from_docket(docket_name):
#     """
#     Return list of unique sales orders from Cut Docket -> Cut Docket SO Details table
#     """
#     if not docket_name:
#         return []

#     docket = frappe.get_doc("Cut Docket", docket_name)
#     sales_orders = set()

#     for row in docket.sale_order_details:
#         if row.sales_order:
#             sales_orders.add(row.sales_order)

#     return list(sales_orders)

