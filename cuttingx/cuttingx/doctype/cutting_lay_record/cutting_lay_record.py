# Copyright (c) 2025, Cognitonx Logic India Private limited and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import cint, get_url_to_form

REQUIRED_ROLE = "Lay Record Approver"
THRESHOLD = 0.98


class CuttingLayRecord(Document):
    def autoname(self):
        """
        Custom naming: LR-{WorkOrderFromCutDocket}-0001
        Uses cut_kanban_no → Cut Docket → first Work Order
        """
        if not self.cut_kanban_no:
            frappe.throw(_("Please select a Cut Kanban No (Cut Docket) before saving."))

        # Fetch Cut Docket document
        try:
            cut_docket = frappe.get_doc("Cut Docket", self.cut_kanban_no)
        except frappe.DoesNotExistError:
            frappe.throw(_("Cut Docket {0} not found.").format(self.cut_kanban_no))

        # Try to get Work Order from work_order_details (preferred)
        work_order = None
        if getattr(cut_docket, "work_order_details", None):
            if cut_docket.work_order_details:
                work_order = cut_docket.work_order_details[0].work_order

        # Fallback: get from table_size_ratio_qty
        if not work_order and getattr(cut_docket, "table_size_ratio_qty", None):
            for row in cut_docket.table_size_ratio_qty:
                if row.ref_work_order:
                    work_order = row.ref_work_order
                    break

        if not work_order:
            frappe.throw(
                _("Cut Docket {0} does not contain any Work Order. "
                  "Please ensure it has at least one Work Order in its size or WO table.").format(self.cut_kanban_no)
            )

        # Sanitize WO name (replace problematic characters)
        wo_clean = str(work_order).replace("/", "-").replace("\\", "-").replace(" ", "-")

        # Generate name: LR-{WO}-0001
        prefix = f"LR-{wo_clean}"
        self.name = frappe.model.naming.make_autoname(prefix + "-.####")

    # ---------------- Threshold Logic ----------------

    def _below_threshold(self) -> bool:
        total_piece = float(self.total_piece or 0)
        actual_total_piece = float(self.actual_total_piece or 0)
        if total_piece <= 0:
            return False
        return actual_total_piece < (THRESHOLD * total_piece)

    def validate(self):
        # Enforce Cut Kanban No is submitted
        # NOTE: If cut_kanban_no links to a different doctype than "Cut Docket", update this doctype name.
        if self.cut_kanban_no:
            ds = frappe.db.get_value("Cut Docket", self.cut_kanban_no, "docstatus")
            if ds != 1:
                frappe.throw(_("Cut Kanban No must be a submitted Cut Docket (docstatus = 1)."))

        # ✅ Removed: requester_remarks mandatory enforcement
        # ✅ Removed: approval restriction validation

    def on_submit(self):
        """
        ✅ NEW BEHAVIOR:
        - If below threshold, notify Can Cut Managers via bell + email (ONLY notification, no restriction)
        - Also notify owner as before
        """
        # 1) Notify managers if below threshold
        if self._below_threshold():
            managers = _get_users_with_role(REQUIRED_ROLE)
            if managers:
                subject = f"[FYI] Cutting Lay Record below {int(THRESHOLD * 100)}% - {self.name}"
                link = get_url_to_form(self.doctype, self.name)

                msg = _(
                    "Cutting Lay Record <b>{0}</b> has been <b>submitted</b>, but "
                    "Actual Total Piece is below <b>{1}%</b> of Total Piece.<br>"
                    "Link: <a href='{2}'>{2}</a><br><br>"
                    "<b>Total Piece:</b> {3}<br>"
                    "<b>Actual Total Piece:</b> {4}<br>"
                    "<b>Requester Remarks:</b><br>{5}<br><br>"
                    "<b>Approver Remarks:</b><br>{6}"
                ).format(
                    self.name,
                    int(THRESHOLD * 100),
                    link,
                    frappe.utils.escape_html(str(self.total_piece or "")),
                    frappe.utils.escape_html(str(self.actual_total_piece or "")),
                    frappe.utils.escape_html((self.requester_remarks or "").strip() or "-"),
                    frappe.utils.escape_html((self.approver_remarks or "").strip() or "-"),
                )

                _notify_users(managers, subject, msg, self)

        # 2) Notify document owner once submitted (email + in-app)
        owner = self.owner
        if owner:
            subject = f"[Submitted] Cutting Lay Record {self.name}"
            link = get_url_to_form(self.doctype, self.name)
            msg = _(
                "Cutting Lay Record <b>{0}</b> has been submitted.<br>"
                "Link: <a href='{1}'>{1}</a>"
            ).format(self.name, link)

            _notify_users([owner], subject, msg, self)


# ---------------- Whitelisted Methods ----------------

@frappe.whitelist()
def get_cut_docket_details(cut_kanban_no):
    """
    Returns:
    {
        "ocn": "...",
        "style": "...",
        "colour": "..."
    }
    """
    if not cut_kanban_no or not frappe.db.exists("Cut Docket", cut_kanban_no):
        return None

    # Get parent fields: style, colour
    cut_docket = frappe.db.get_value(
        "Cut Docket",
        cut_kanban_no,
        ["style_no", "color"],
        as_dict=1
    )

    if not cut_docket:
        return None

    # Get FIRST ocn (sales_order) from child table
    ocn = frappe.db.get_value(
        "Cut Docket Item",
        {"parent": cut_kanban_no, "parenttype": "Cut Docket"},
        "sales_order",
        order_by="idx"
    )

    return {
        "ocn": ocn,
        "style": cut_docket.style_no,
        "colour": cut_docket.color
    }


@frappe.whitelist()
def get_styles_for_ocn(sales_order):
    """Return list of styles (custom_style from Sales Order Item)."""
    if not sales_order:
        return []

    styles = frappe.db.sql("""
        SELECT DISTINCT soi.custom_style
        FROM `tabSales Order Item` soi
        WHERE soi.parent = %s
          AND soi.custom_style IS NOT NULL
          AND soi.custom_style != ''
    """, (sales_order,), as_dict=1)

    return [d.custom_style for d in styles]


@frappe.whitelist()
def get_colors_for_style_in_ocn(sales_order, style):
    """Return list of colors (custom_color from Sales Order Item) for given style."""
    if not sales_order or not style:
        return []

    colors = frappe.db.sql("""
        SELECT DISTINCT soi.custom_color
        FROM `tabSales Order Item` soi
        WHERE soi.parent = %s
          AND soi.custom_style = %s
          AND soi.custom_color IS NOT NULL
          AND soi.custom_color != ''
    """, (sales_order, style), as_dict=1)

    return [d.custom_color for d in colors]


@frappe.whitelist()
def get_sizes_for_ocn(sales_order, style, colour):
    """Return distinct custom_size from Sales Order Items matching style and colour."""
    if not (sales_order and style and colour):
        return []

    sizes = frappe.db.sql("""
        SELECT DISTINCT soi.custom_size
        FROM `tabSales Order Item` soi
        WHERE 
            soi.parent = %s
            AND soi.custom_style = %s
            AND soi.custom_color = %s
            AND soi.custom_size IS NOT NULL
            AND soi.custom_size != ''
        ORDER BY soi.custom_size
    """, (sales_order, style, colour), as_dict=1)

    return [d.custom_size for d in sizes]


@frappe.whitelist()
def get_next_cut_no(cut_kanban_no, ocn, style, colour):
    if not (cut_kanban_no and ocn and style and colour):
        return 1

    max_cut_no = frappe.db.sql("""
        SELECT MAX(cut_no) 
        FROM `tabCutting Lay Record`
        WHERE 
            cut_kanban_no = %s
            AND ocn = %s
            AND style = %s
            AND colour = %s
            AND docstatus < 2
    """, (cut_kanban_no, ocn, style, colour), as_list=1)

    current_max = max_cut_no[0][0] if max_cut_no and max_cut_no[0][0] is not None else 0
    return cint(current_max) + 1


@frappe.whitelist()
def get_grn_items_for_fg_or_colour(ocn, fg_item=None, colour=None):
    """
    Return available GRN fabric rolls for a given OCN, FG item, and colour.
    
    Supports:
      - NEW: GRNs with GRN OCN FG Mapping child table (multi-OCN, multi-FG, multi-colour support)
      - LEGACY: GRNs with direct ocn + fg_item fields
      - OLD: GRNs without fg_item → match by colour only
      
    Args:
        ocn (str): Order Confirmation Number
        fg_item (str, optional): Finished Goods item code
        colour (str, optional): Fabric color
        
    Returns:
        list: Available roll details with net quantity
    """
    if not ocn:
        return []

    grn_items = []

    # --- STRATEGY 1: GRNs with GRN OCN FG Mapping (NEW - supports multi-OCN, multi-FG, multi-colour) ---
    if fg_item and colour:
        # Find GRNs that have a mapping entry for this OCN + FG Item + Colour combination
        mapped_grns = frappe.db.sql("""
            SELECT DISTINCT parent 
            FROM `tabGRN OCN FG Mapping`
            WHERE 
                ocn = %s
                AND fg_item = %s
                AND fg_item_colour = %s
                AND parenttype = 'Goods Receipt Note'
        """, (ocn, fg_item, colour), as_list=1)
        
        mapped_grn_names = [g[0] for g in mapped_grns if g[0]]
        
        if mapped_grn_names:
            # Verify these GRNs are submitted
            submitted_mapped_grns = frappe.db.sql("""
                SELECT name 
                FROM `tabGoods Receipt Note`
                WHERE 
                    name IN %s
                    AND docstatus = 1
            """, (tuple(mapped_grn_names),), as_list=1)
            
            mapped_grn_names = [g[0] for g in submitted_mapped_grns]
        
        if mapped_grn_names:
            # Get rolls matching the colour from GRN items
            items = frappe.db.sql("""
                SELECT 
                    gri.name AS grn_item_reference,
                    gri.parent AS grn,
                    gri.roll_no,
                    gri.received_quantity,
                    gri.fabric_width AS width,
                    gri.dia,
                    gri.color
                FROM `tabGoods Receipt Item` gri
                WHERE 
                    gri.parent IN %s
                    AND gri.color = %s
                    AND gri.roll_no IS NOT NULL
                    AND gri.received_quantity > 0
            """, (tuple(mapped_grn_names), colour), as_dict=1)
            grn_items.extend(items)

    # --- STRATEGY 2: Direct OCN + FG Item + Colour match (LEGACY - single OCN, single FG) ---
    if fg_item and colour and not grn_items:
        # Only try this if mapping approach found nothing
        legacy_grns = frappe.db.sql("""
            SELECT name 
            FROM `tabGoods Receipt Note`
            WHERE 
                ocn = %s
                AND fg_item = %s
                AND docstatus = 1
        """, (ocn, fg_item), as_list=1)
        
        legacy_grn_names = [g[0] for g in legacy_grns]
        
        if legacy_grn_names:
            items = frappe.db.sql("""
                SELECT 
                    gri.name AS grn_item_reference,
                    gri.parent AS grn,
                    gri.roll_no,
                    gri.received_quantity,
                    gri.fabric_width AS width,
                    gri.dia,
                    gri.color
                FROM `tabGoods Receipt Item` gri
                WHERE 
                    gri.parent IN %s
                    AND gri.color = %s
                    AND gri.roll_no IS NOT NULL
                    AND gri.received_quantity > 0
            """, (tuple(legacy_grn_names), colour), as_dict=1)
            grn_items.extend(items)

    # --- STRATEGY 3: OLD GRNs (colour-based matching only) ---
    if colour and not grn_items:
        # Get GRNs for this OCN that DON'T have fg_item or mappings
        old_grns = frappe.db.sql("""
            SELECT name 
            FROM `tabGoods Receipt Note`
            WHERE 
                ocn = %s
                AND docstatus = 1
                AND (fg_item IS NULL OR fg_item = '')
        """, (ocn,), as_list=1)
        
        old_grn_names = [g[0] for g in old_grns]
        
        # Exclude GRNs that have GRN OCN FG Mapping entries (they use new system)
        if old_grn_names:
            grns_with_mapping = frappe.db.sql("""
                SELECT DISTINCT parent 
                FROM `tabGRN OCN FG Mapping`
                WHERE parent IN %s
            """, (tuple(old_grn_names),), as_list=1)
            
            mapped_grns = {g[0] for g in grns_with_mapping}
            old_grn_names = [g for g in old_grn_names if g not in mapped_grns]
        
        if old_grn_names:
            items = frappe.db.sql("""
                SELECT 
                    gri.name AS grn_item_reference,
                    gri.parent AS grn,
                    gri.roll_no,
                    gri.received_quantity,
                    gri.fabric_width AS width,
                    gri.dia,
                    gri.color
                FROM `tabGoods Receipt Item` gri
                WHERE 
                    gri.parent IN %s
                    AND gri.color = %s
                    AND gri.roll_no IS NOT NULL
                    AND gri.received_quantity > 0
            """, (tuple(old_grn_names), colour), as_dict=1)
            grn_items.extend(items)

    if not grn_items:
        return []

    # --- Deduct Sample Fabric Issuance (by GRN + Roll) ---
    grn_roll_pairs = [(g["grn"], g["roll_no"]) for g in grn_items]
    issued_data = frappe.db.sql("""
        SELECT grn, roll, SUM(issued_quantity) AS total_issued
        FROM `tabSample Fabric Issuance`
        WHERE 
            docstatus = 1
            AND grn IS NOT NULL
            AND roll IS NOT NULL
            AND (grn, roll) IN %s
        GROUP BY grn, roll
    """, (tuple(grn_roll_pairs),), as_dict=1)

    issued_map = {(d["grn"], d["roll"]): d["total_issued"] for d in issued_data}

    # --- Deduct Cutting Lay Usage (by GRN + Roll) ---
    # CRITICAL: We group by (grn, roll_no) instead of grn_item_reference
    # This ensures that usage is tracked per physical roll, regardless of which
    # GRN item row or OCN/FG Item/Colour was used to reference it
    
    # First, get all GRN names from our items
    grn_names = list(set([g["grn"] for g in grn_items]))
    
    used_data = frappe.db.sql("""
        SELECT 
            gri.parent AS grn,
            gri.roll_no,
            SUM(COALESCE(lr.actual_total, 0)) AS total_used
        FROM `tabLay Roll Details` lr
        INNER JOIN `tabCutting Lay Record` clr ON lr.parent = clr.name
        INNER JOIN `tabGoods Receipt Item` gri ON lr.grn_item_reference = gri.name
        WHERE 
            clr.docstatus < 2
            AND gri.parent IN %s
            AND gri.roll_no IS NOT NULL
        GROUP BY gri.parent, gri.roll_no
    """, (tuple(grn_names),), as_dict=1)

    used_map = {(d["grn"], d["roll_no"]): d["total_used"] for d in used_data}

    # --- Compute net available per roll ---
    # Group items by (grn, roll_no) to handle cases where same roll appears multiple times
    roll_map = {}
    for item in grn_items:
        key = (item["grn"], item["roll_no"])
        if key not in roll_map:
            roll_map[key] = item
    
    result = []
    for (grn, roll_no), item in roll_map.items():
        issued_qty = issued_map.get((grn, roll_no), 0.0)
        used_qty = used_map.get((grn, roll_no), 0.0)
        net_qty = item["received_quantity"] - issued_qty - used_qty

        if net_qty > 0:
            result.append({
                "grn_item_reference": item["grn_item_reference"],
                "roll_no": roll_no,
                "roll_weight": net_qty,
                "width": item["width"],
                "dia": item["dia"],
            })

    # --- Sort rolls safely ---
    def safe_roll_sort_key(item):
        roll = str(item.get("roll_no") or "").strip()
        if '/' in roll:
            parts = roll.split('/', 1)
            try:
                a = int(parts[0]) if parts[0].isdigit() else 0
                b = int(parts[1]) if parts[1].isdigit() else 0
                return (a, b)
            except (ValueError, IndexError):
                return (float('inf'), roll)
        try:
            return (int(roll), 0)
        except ValueError:
            return (float('inf'), roll)

    return sorted(result, key=safe_roll_sort_key)


# ---------------- Notification Helpers ----------------

def _get_users_with_role(role: str):
    users = frappe.get_all(
        "Has Role",
        filters={"role": role, "parenttype": "User"},
        pluck="parent"
    ) or []

    if not users:
        return []

    enabled_users = frappe.get_all(
        "User",
        filters={"name": ["in", users], "enabled": 1},
        pluck="name"
    ) or []

    # unique preserve order
    return list(dict.fromkeys(enabled_users))


def _notify_users(usernames, subject, html_message, doc):
    if not usernames:
        return

    # In-app notifications
    for u in usernames:
        try:
            frappe.get_doc({
                "doctype": "Notification Log",
                "subject": subject,
                "email_content": html_message,
                "for_user": u,
                "type": "Alert",
                "document_type": doc.doctype,
                "document_name": doc.name
            }).insert(ignore_permissions=True)
        except Exception:
            frappe.log_error(frappe.get_traceback(), "CuttingLayRecord Notification Log Failed")

    # Email notifications
    emails = frappe.get_all("User", filters={"name": ["in", usernames]}, fields=["email"])
    recipients = [d.email for d in emails if d.get("email")]

    if recipients:
        try:
            frappe.sendmail(
                recipients=recipients,
                subject=subject,
                message=html_message,
                reference_doctype=doc.doctype,
                reference_name=doc.name
            )
        except Exception:
            frappe.log_error(frappe.get_traceback(), "CuttingLayRecord Email Failed")
