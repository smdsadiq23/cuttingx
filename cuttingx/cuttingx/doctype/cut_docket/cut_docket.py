# Copyright (c) 2025, Cognitonx Logic India Private Limited and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
import json
from frappe.utils import flt
from labelx.utils.generators import generate_barcode_base64, generate_qrcode_base64

class CutDocket(Document):
    def before_save(self):
        """Generate and store barcode & QR code if not already set"""
        if not self.barcode_image or not self.qr_code_image:
            code = self.name  # Use the document name as the code

            # Generate Base64 images
            barcode_b64 = generate_barcode_base64(code)
            qrcode_b64 = generate_qrcode_base64(code)

            # Store in fields
            self.barcode_image = barcode_b64
            self.qr_code_image = qrcode_b64


    def validate(self):
        if self.style:
            self.set_bom_no_from_style()
            self.set_panel_type_from_bom()
        self.calculate_fabric_requirement()
        self.calculate_fabric_requirement_against_marker()
        self.calculate_marker_efficiency()
        self.validate_no_negative_balance()
        

    def set_bom_no_from_style(self):
        """Set bom_no from Item's default_bom using selected style"""
        if not self.style:
            frappe.throw(_("Please select a Style to fetch BOM."))

        item = frappe.get_doc("Item", self.style)

        if not item.default_bom:
            frappe.throw(_("Item '{0}' does not have a default BOM.").format(self.style))

        self.bom_no = item.default_bom
        

    def set_panel_type_from_bom(self):
        """
        Auto-set panel_type from BOM only if not already selected by user.
        Only sets if exactly one unique custom_fg_link exists for Fabric items.
        """
        if not self.bom_no or self.panel_type:
            return

        try:
            bom = frappe.get_doc("BOM", self.bom_no)
        except frappe.DoesNotExistError:
            frappe.msgprint(_("BOM {0} not found").format(self.bom_no))
            return

        fabric_links = {
            item.custom_fg_link for item in bom.items
            if item.custom_item_type == "Fabrics" and item.custom_fg_link
        }

        if len(fabric_links) == 1:
            self.panel_type = list(fabric_links)[0]
        elif len(fabric_links) > 1:
            # Multiple options exist — let user choose
            pass
        else:
            self.panel_type = None
            

    def calculate_fabric_requirement(self):
        """
        Calculates total fabric requirement against BOM for the selected panel_type.

        Primary rule:
        - Match BOM Items where custom_fg_link == panel_type and custom_item_type == "Fabrics"
        - For each Cut Docket size row, find BOM row with same custom_size and add: (bom.qty * planned_cut_quantity)

        Fallback rule (when no size matches):
        - If among the matching BOM items there is exactly ONE row whose custom_size is blank/None,
            then use that BOM row's qty multiplied by the TOTAL planned_cut_quantity across all sizes.
        """

        if not self.bom_no or not self.panel_type or not self.table_size_ratio_qty:
            self.fabric_requirement_against_bom = 0
            return

        try:
            bom = frappe.get_doc("BOM", self.bom_no)
        except frappe.DoesNotExistError:
            frappe.throw(_("BOM {0} not found").format(self.bom_no))

        # 1) Filter BOM items for the selected panel type and Fabrics
        matching_bom_items = [
            item for item in (bom.items or [])
            if item.custom_fg_link == self.panel_type and item.custom_item_type == "Fabrics"
        ]

        if not matching_bom_items:
            frappe.msgprint(_("No matching BOM items found for panel code '{0}'").format(self.panel_type))
            self.fabric_requirement_against_bom = 0
            return

        # 2) Try size-by-size matching first
        total_qty = 0.0
        for size_row in self.table_size_ratio_qty:
            size_key = (size_row.size or "").strip().lower()
            if not size_key:
                continue

            matched_item = next(
                (
                    item for item in matching_bom_items
                    if (item.custom_size or "").strip().lower() == size_key
                ),
                None
            )

            if matched_item:
                total_qty += flt(matched_item.qty) * flt(size_row.planned_cut_quantity)

        if total_qty > 0:
            self.fabric_requirement_against_bom = total_qty
            return

        # 3) Fallback: no sizes matched. If exactly one BOM row has no custom_size, use it for ALL sizes.
        bom_items_no_size = [
            item for item in matching_bom_items
            if not (item.custom_size or "").strip()
        ]

        if len(bom_items_no_size) == 1:
            per_unit = flt(bom_items_no_size[0].qty)
            total_planned = sum(flt(r.planned_cut_quantity) for r in self.table_size_ratio_qty)
            self.fabric_requirement_against_bom = per_unit * total_planned
            return

        # 4) If we reach here, there were either multiple no-size rows or none; keep as zero
        self.fabric_requirement_against_bom = 0


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


    def validate_no_negative_balance(self):
        for row in self.table_size_ratio_qty:
            if flt(row.balance) < 0:
                frappe.throw(
                    _("Negative balance found for Size '{0}' and Work Order '{1}'. Check planned quantity.").format(
                        row.size, row.ref_work_order or "Unknown"
                    )
                )

            
    def on_submit(self):
        """
        Notify all users with "Stock User" role when Cut Docket is submitted
        """
        self.notify_stock_users_on_submit()


    def notify_stock_users_on_submit(self):
        """
        Send email and desktop notification to all users with 'Stock User' or 'Stock Manager' role
        """
        from frappe.utils import get_url_to_form

        roles_to_notify = ["Stock User", "Stock Manager"]

        # Get users with any of the roles
        stock_users = frappe.get_all(
            "Has Role",
            filters={
                "role": ["in", roles_to_notify],
                "parenttype": "User"
            },
            pluck="parent"
        )

        # Filter only enabled users
        enabled_users = frappe.get_all("User", filters={"enabled": 1}, pluck="name")
        recipients = list(set(user for user in stock_users if user in enabled_users))

        # Remove current user (submitter) from recipients
        recipients = [user for user in recipients if user != frappe.session.user]        

        if not recipients:
            return

        # ✅ Ensure name exists
        if not self.name:
            frappe.log_error("Cut Docket has no name when submitting", "Cut Docket Submit Error")
            return

        subject = f"✅ Cut Docket {self.name} Submitted"
        message = f"""
            <p>The <b>Cut Docket {self.name}</b> has been <b>submitted</b>.</p>
            <p><b>Style:</b> {self.style or 'Not set'}</p>
            <p><b>Fabric Requirement:</b> {self.fabric_requirement_against_bom} m²</p>
            <p><a href="{get_url_to_form('Cut Docket', self.name)}" target="_blank">View Cut Docket</a></p>
        """

        # 📧 Send Email
        frappe.sendmail(
            recipients=recipients,
            subject=subject,
            message=message
        )

        # 💬 Send Desktop Notification
        for user in recipients:
            # ✅ Always send a non-empty message
            msg = f"✅ Cut Docket {self.name} submitted."
            frappe.publish_realtime(
                "msgprint",
                message=msg,
                user=user
            )


def autofill_barcode_and_save(doc, method):
    """
    After first save, set barcode_text = doc.name and save again.
    """
    # Only run if barcode_text is empty
    if not doc.barcode:
        # Use db_set to avoid full validation
        doc.db_set('barcode', doc.name, commit=True)

        # Optional: log it
        # frappe.msgprint(f"Barcode auto-filled with {doc.name}")                      


@frappe.whitelist()
def get_details_on_panel_type_change(bom_no, panel_type):
    """
    Returns:
    - panel_code (from BOM Item)
    - garment_way (from BOM Item)
    - fabricmaterial_details (item_code from BOM Item)
    - raw_material_composition (custom_material_composition from Item)
    
    Filters:
    - custom_fg_link == panel_type
    - custom_item_type == "Fabrics"
    """
    if not bom_no or not panel_type:
        return {}

    try:
        bom = frappe.get_doc("BOM", bom_no)
    except frappe.DoesNotExistError:
        return {}

    for item in bom.items:
        if item.custom_item_type == "Fabrics" and item.custom_fg_link == panel_type:
    # for item in bom.custom_fabrics_items:
    #     if item.custom_fg_link == panel_type:
            item_code = item.item_code
            # Fetch custom_material_composition from Item
            composition = ""
            if item_code:
                composition = frappe.db.get_value("Item", item_code, "custom_material_composition") or ""

            return {
                "panel_code": item.custom_panel_code or "",
                "garment_way": item.custom_garment_way or "",
                "fabricmaterial_details": item_code or "",
                "raw_material_composition": composition
            }

    return {}


# @frappe.whitelist()
# def get_panel_code_and_garment_way_from_bom(bom_no, panel_type):
#     """
#     Returns custom_panel_code and custom_garment_way from BOM Item where:
#     - parent = bom_no
#     - custom_fg_link = panel_type
#     - parentfield = 'custom_fabrics_items'
#     """
#     if not bom_no or not panel_type:
#         return {}

#     result = frappe.db.sql("""
#         SELECT custom_panel_code, custom_garment_way
#         FROM `tabBOM Item`
#         WHERE parent = %s
#         AND parentfield = 'custom_fabrics_items'
#         AND custom_fg_link = %s
#         LIMIT 1
#     """, (bom_no, panel_type), as_dict=True)

#     if result:
#         return {
#             "panel_code": result[0].custom_panel_code or "",
#             "garment_way": result[0].custom_garment_way or ""
#         }

#     return {}


@frappe.whitelist()
def get_fabric_requirement(bom_no, panel_type, size_table):
    """Return fabric requirement for the given BOM/panel_type and size table.

    Primary: sum(matched_bom.qty * planned_cut_quantity) for rows where
      - BOM Item.custom_item_type == "Fabrics"
      - BOM Item.custom_fg_link == panel_type
      - BOM Item.custom_size matches row.size

    Fallback: if there are **no size matches**, and there is **exactly one**
    matching BOM Item with **blank/None custom_size**, then use:
      per_unit_qty_of_that_item * sum(all planned_cut_quantity)
    """

    if not bom_no or not panel_type or not size_table:
        return 0

    try:
        bom = frappe.get_doc("BOM", bom_no)
    except frappe.DoesNotExistError:
        return 0

    size_rows = json.loads(size_table) or []

    # Filter BOM items for the selected panel type & Fabrics
    matching_bom_items = [
        item for item in (bom.items or [])
        if item.custom_item_type == "Fabrics" and item.custom_fg_link == panel_type
    ]
    if not matching_bom_items:
        return 0

    total_qty = 0.0

    # Try size-by-size matching first
    for row in size_rows:
        size = (row.get("size") or "").strip().lower()
        planned_qty = flt(row.get("planned_cut_quantity"))

        if not size or planned_qty <= 0:
            continue

        matched_item = next(
            (it for it in matching_bom_items if (it.custom_size or "").strip().lower() == size),
            None
        )
        if matched_item:
            total_qty += flt(matched_item.qty) * planned_qty

    if total_qty > 0:
        return total_qty

    # Fallback: no size matches. If exactly one no-size BOM row exists, apply it to ALL sizes.
    bom_items_no_size = [
        it for it in matching_bom_items
        if not (it.custom_size or "").strip()
    ]
    if len(bom_items_no_size) == 1:
        per_unit = flt(bom_items_no_size[0].qty)
        total_planned = sum(flt(r.get("planned_cut_quantity")) for r in size_rows)
        return per_unit * total_planned

    # Otherwise, keep it zero
    return 0

# @frappe.whitelist()
# def get_sales_orders_by_item(doctype, txt, searchfield, start, page_len, filters):
#     style = filters.get("style")
#     if not style:
#         return []

#     return frappe.db.sql("""
#         SELECT DISTINCT so.name
#         FROM `tabSales Order` so
#         JOIN `tabSales Order Item` soi ON soi.parent = so.name
#         WHERE soi.item_code = %s
#         AND so.docstatus = 1
#         AND so.status != 'Closed'
#         AND so.name LIKE %s
#         ORDER BY so.name ASC
#         LIMIT %s OFFSET %s
#     """, (style, f"%{txt}%", page_len, start))


@frappe.whitelist()
def get_work_orders_by_item(doctype, txt, searchfield, start, page_len, filters):
    item_code = filters.get("item_code")
    if not item_code:
        return []

    return frappe.db.sql("""
        SELECT wo.name
        FROM `tabWork Order` wo
        WHERE wo.docstatus < 2
          AND wo.status != 'Closed'
          AND wo.production_item = %s
          AND wo.name LIKE %s
        ORDER BY wo.name DESC
        LIMIT %s OFFSET %s
    """, (item_code, f"%{txt}%", page_len, start))


@frappe.whitelist()
def get_already_cut_quantity(work_order):
    if not work_order:
        return 0

    total = frappe.db.sql("""
        SELECT SUM(planned_cut_quantity)
        FROM `tabCut Docket Item`
        WHERE ref_work_order = %s
    """, (work_order,), as_dict=True)

    return total[0]["SUM(planned_cut_quantity)"] or 0


@frappe.whitelist()
def get_cut_docket_items_from_work_orders(work_orders):
    """
    Given a list of work orders, return size-wise rows with:
    - size (ordered as in Work Order Line Item table)
    - quantity (work_order_allocated_qty)
    - already_cut (sum of planned_cut_quantity from Cut Docket Item)
    - balance = quantity - already_cut
    """
    work_orders = json.loads(work_orders)
    result = []

    for wo in work_orders:
        wo_doc = frappe.get_doc("Work Order", wo)
        wo_line_items = wo_doc.get("custom_work_order_line_items") or []

        for line in wo_line_items:
            sales_order = line.sales_order
            line_item_no = line.line_item_no  
            size = line.size
            allocated_qty = float(line.work_order_allocated_qty or 0)
          
            already_cut_result = frappe.db.sql("""
                SELECT SUM(planned_cut_quantity) as total_cut
                FROM `tabCut Docket Item`
                WHERE 
                    ref_work_order = %s
                    AND sales_order = %s
                    AND line_item_no = %s
                    AND size = %s
            """, (wo, sales_order, line_item_no, size), as_dict=True)

            already_cut = float(already_cut_result[0].total_cut or 0) if already_cut_result else 0

            result.append({
                'ref_work_order': wo,
                'sales_order': sales_order,
                'line_item_no': line_item_no,                
                'size': size,
                'quantity': allocated_qty,
                'already_cut': already_cut,
                'planned_cut_quantity': 0,
                'balance': allocated_qty - already_cut
            })

    return result


@frappe.whitelist()
def get_empty_work_order_list(doctype, txt, searchfield, start, page_len, filters):
    """Returns empty list - used to disable dropdown when no style is selected"""
    return []


@frappe.whitelist()
def allocate_fabric_rolls(docname):
    """
    Allocate fabric rolls using ONLY `fabric_requirement_against_marker` (length units).
    ALWAYS derive PRs via Sales Order -> MRP -> PO -> GRN -> PR (no PRs read from child rows).

    Flow:
      1) Validate `fabric_requirement_against_marker` > 0.
      2) Collect unique Sales Orders from `table_size_ratio_qty` (order preserved).
      3) For each SO, resolve PR via SO -> MRP -> PO -> GRN -> PR. Build PR list (order preserved).
      4) For each PR, allocate by roll_number (ascending):
            total_len(roll) = custom_fabric_length; if 0/None -> fallback to qty
            available = total_len - (prev dockets' allocations + allocations in this run)
         Keep appending allocation rows until requirement is satisfied or rolls exhausted.
      5) Write `roll_length` from PR baseline and `balance_length` = remaining length.
    Notes:
      - `table_size_ratio_qty` is used ONLY to discover Sales Orders (not for quantities).
      - Qty is NEVER used unless `custom_fabric_length` is 0/None (fallback only).
    """
    # ---------- helpers ----------
    def get_pr_for_sales_order(so: str) -> str | None:
        """Return PR via SO -> MRP -> PO -> GRN -> PR, or None with a warning."""
        if not so:
            return None

        mrp_name = frappe.db.get_value(
            "Material Requirement Plan Item",
            {"sales_order": so, "docstatus": 1},
            "parent",
        )
        if not mrp_name:
            frappe.msgprint(_("No MRP found for SO {0}").format(so), alert=True)
            return None

        po = frappe.db.get_value(
            "Purchase Order Item",
            {"custom_reference_parent_id": mrp_name, "custom_reference_type": "MRP", "docstatus": 1},
            "parent",
        )
        if not po:
            frappe.msgprint(_("No PO for MRP {0} (SO {1})").format(mrp_name, so), alert=True)
            return None

        grn = frappe.db.get_value(
            "Goods Receipt Note", {"purchase_order": po, "docstatus": 1}, "name"
        )
        if not grn:
            frappe.msgprint(_("No GRN for PO {0} (SO {1})").format(po, so), alert=True)
            return None

        pr = frappe.db.get_value(
            "Purchase Receipt", {"linked_grn": grn, "docstatus": 1}, "name"
        )
        if not pr:
            frappe.msgprint(_("No PR for GRN {0} (SO {1})").format(grn, so), alert=True)
            return None

        return pr

    def ensure_pr_state(pr: str, docname: str, cache: dict):
        """
        Build per-PR state once:
          - roll_len: {roll_no: total length}   (custom_fabric_length; fallback to qty if length is 0/None)
          - used:     {roll_no: length used}    (previous dockets for this PR)
          - order:    [roll_no sorted asc]
          - meta:     {roll_no: {batch_no, shade, warehouse, pr_item_name}}
        """
        if pr in cache:
            return cache[pr]

        items = frappe.get_all(
            "Purchase Receipt Item",
            filters={
                "parent": pr,
                "item_group": "Fabrics",
                "custom_roll_no": ["is", "set"],
            },
            fields=[
                "custom_roll_no as roll_no",
                "custom_grn_batch_no as batch_no",
                "custom_shade as shade",
                "warehouse as warehouse",
                "custom_fabric_length as roll_length",  # authoritative; fallback to qty if 0/None
                "qty",                                   # fallback only
                "name as pr_item_name",
            ],
            order_by="custom_roll_no asc",
        )

        roll_len, meta, roll_numbers = {}, {}, []
        for it in items:
            rn = (it.roll_no or "").strip()
            if not rn:
                continue
            length = flt(it.roll_length)
            if length <= 0:
                length = flt(it.qty)  # fallback ONLY when length is not provided/zero
            roll_len[rn] = roll_len.get(rn, 0.0) + length
            roll_numbers.append(rn)
            meta[rn] = {
                "batch_no": it.batch_no,
                "shade": it.shade,
                "warehouse": it.warehouse,
                "pr_item_name": it.pr_item_name,
            }

        if not roll_len:
            return None

        # Sum previous allocations for this PR across other dockets
        prev_rows = frappe.get_all(
            "Cut Docket Roll Allocation",
            filters={
                "docstatus": ["<", 2],
                "parent": ["!=", docname],
                "purchase_receipt": pr,
                "roll_number": ["in", list(roll_len.keys())],
            },
            fields=["roll_number", "to_be_allocated"],
            limit_page_length=0,
        )
        used = {}
        for r in prev_rows:
            used[r.roll_number] = used.get(r.roll_number, 0.0) + flt(r.to_be_allocated)

        cache[pr] = {
            "roll_len": roll_len,
            "used": used,
            "order": sorted(set(roll_numbers), key=lambda x: x),  # strict roll_number order
            "meta": meta,
        }
        return cache[pr]

    try:
        doc = frappe.get_doc("Cut Docket", docname)

        # 1) Validate requirement
        requirement = flt(doc.get("fabric_requirement_against_marker"))
        if requirement <= 0:
            frappe.throw(_("Fabric Requirement Against Marker is empty or zero. Please enter a value before allocating."))

        # 2) Collect unique Sales Orders from table_size_ratio_qty (order preserved)
        sos = []
        seen_sos = set()
        for row in (doc.get("table_size_ratio_qty") or []):
            so = (row.get("sales_order") or "").strip()
            if so and so not in seen_sos:
                sos.append(so)
                seen_sos.add(so)

        if not sos:
            frappe.throw(_("No Sales Orders found in Size Ratio table. Add at least one SO to resolve PR(s)."))

        # 3) Resolve PRs via SO -> MRP -> PO -> GRN -> PR (order preserved, deduped)
        prs = []
        seen_prs = set()
        for so in sos:
            pr = get_pr_for_sales_order(so)
            if pr and pr not in seen_prs:
                prs.append((pr, so))  # keep SO for optional traceability on rows
                seen_prs.add(pr)

        if not prs:
            frappe.throw(_("Could not resolve any Purchase Receipts from the Sales Orders via MRP → PO → GRN → PR."))

        # 4) Clear table and allocate the single requirement across PRs
        doc.set("table_roll_details", [])
        has_error = False
        pr_cache = {}
        remaining = requirement

        for pr, so in prs:
            if remaining <= 0:
                break

            state = ensure_pr_state(pr, docname, pr_cache)
            if not state:
                frappe.msgprint(_("No fabric rolls found in Purchase Receipt {0}. Skipping.").format(pr), alert=True)
                has_error = True
                continue

            roll_len = state["roll_len"]
            used = state["used"]     # will be mutated as we allocate
            order = state["order"]
            meta = state["meta"]

            for rn in order:
                if remaining <= 0:
                    break

                total_len = flt(roll_len.get(rn, 0.0))
                already = flt(used.get(rn, 0.0))
                available = max(0.0, total_len - already)
                if available <= 0:
                    continue

                alloc_len = min(available, remaining)
                used[rn] = already + alloc_len
                balance_after = max(0.0, total_len - used[rn])

                m = meta.get(rn, {})
                doc.append("table_roll_details", {
                    "roll_number": rn,
                    "batch_number": m.get("batch_no"),
                    "shade": m.get("shade"),
                    "location": m.get("warehouse"),
                    "roll_length": total_len,          # baseline length (len or qty fallback)
                    "to_be_allocated": alloc_len,      # allocated length
                    "balance_length": balance_after,   # remaining length
                    "status": "System Generated",
                    "custom_pr_item": m.get("pr_item_name"),
                    "purchase_receipt": pr,
                    "custom_source_so": so,            # optional traceability
                })

                remaining -= alloc_len

        # 5) Shortage (if any)
        if remaining > 0:
            doc.append("table_roll_details", {
                "roll_number": "",
                "batch_number": "",
                "shade": "",
                "location": "",
                "roll_length": 0,
                "to_be_allocated": 0,
                "balance_length": 0,
                "status": "",
                "remarks": f"Shortage of {remaining} (length units)",
                "purchase_receipt": prs[0][0],  # tag first PR for traceability
            })
            frappe.msgprint(
                _("⚠️ Not enough roll length across derived PR(s). Shortage: {0}").format(remaining),
                alert=True
            )
            has_error = True

        # 6) Save
        doc.save(ignore_permissions=True)

        frappe.msgprint(
            _("✅ Fabric allocated from rolls successfully.")
            if not has_error else _("⚠️ Allocation completed with shortage."),
            alert=True
        )

    except Exception as e:
        frappe.log_error(
            f"Allocation failed for {docname}: {frappe.get_traceback()}",
            "Cut Docket - Roll Allocation Error",
        )
        frappe.throw(_("Failed to allocate fabric rolls: {0}").format(str(e)))
