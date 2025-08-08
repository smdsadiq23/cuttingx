frappe.ui.form.on('Trims Order', {
  onload(frm) {
    frm.get_field('table_trims_order_details').grid.cannot_add_rows = true;
  },
  work_order(frm) {
    // 🔄 Case 1: Work Order is cleared
    if (!frm.doc.work_order) {
      frm.clear_table("table_trims_order_details");
      frm.refresh_field("table_trims_order_details");
      frm.doc.__last_work_order = null;
      return;
    }

    // 🔄 Case 2: Work Order hasn't changed — do nothing
    if (frm.doc.__last_work_order === frm.doc.work_order) return;

    // ✅ Update last selected Work Order
    frm.doc.__last_work_order = frm.doc.work_order;

    // 🔄 Clear existing table before fetching new
    frm.clear_table("table_trims_order_details");
    frm.refresh_field("table_trims_order_details");

    // ✅ Try to fetch from existing trims records
    frappe.call({
      method: "cuttingx.cuttingx.doctype.trims_order.trims_order.get_grouped_trims_data",
      args: {
        work_order: frm.doc.work_order
      },
      callback: function (r) {
        if (r.message && r.message.length > 0) {
          r.message.forEach(row => {
            // ✅ Skip if already issued quantity is equal to or more than WO quantity
            if (flt(row.already_issued_quantity) >= flt(row.wo_quantity)) return;
            frm.add_child("table_trims_order_details", {
              sales_order: row.sales_order,
              line_item_no: row.line_item_no,
              size: row.size,
              item_type: row.item_type,
              item_code: row.item_code,
              uom: row.uom,
              per_unit_quantity: row.per_unit_quantity,
              wo_quantity: row.wo_quantity,
              already_issued_quantity: row.already_issued_quantity
            });
          });
          frm.refresh_field("table_trims_order_details");
        } else {
          // 🧾 Fallback to BOM logic if no trims issued yet
          frappe.call({
            method: "cuttingx.cuttingx.doctype.trims_order.trims_order.get_fallback_bom_trims",
            args: {
              work_order: frm.doc.work_order
            },
            callback: function (r) {
              if (r.message && r.message.length > 0) {
                r.message.forEach(row => {
                  frm.add_child("table_trims_order_details", {
                    sales_order: row.sales_order,
                    line_item_no: row.line_item_no,
                    size: row.size,
                    item_type: row.item_type,
                    item_code: row.item_code,
                    uom: row.uom,
                    per_unit_quantity: row.per_unit_quantity,
                    wo_quantity: row.wo_quantity,
                    already_issued_quantity: 0
                  });
                });
                frm.refresh_field("table_trims_order_details");
              }
            }
          });
        }
      }
    });
  }, 
  before_save(frm) {
    (frm.doc.table_trims_order_details || []).forEach((row, idx) => {
      if (!row.trims_order_quantity || flt(row.trims_order_quantity) === 0) {
        frappe.throw(
          `Please enter a valid <b>Trims Order Quantity</b> for row <b>${idx + 1}</b> ` +
          `(Sales Order: <b>${row.sales_order || "?"}</b>, Size: <b>${row.size || "?"}</b>, Item: <b>${row.item_code || "?"}</b>)`
        );
      }
    });
  }
});

frappe.ui.form.on('Trims Order Item', {
  trims_order_quantity(frm, cdt, cdn) {
    const row = locals[cdt][cdn];

    const max_allowed_qty = flt(row.wo_quantity) - flt(row.already_issued_quantity);

    if (flt(row.trims_order_quantity) > max_allowed_qty) {
      frappe.msgprint(`Trims Order Quantity must be less than or equal to ${max_allowed_qty}`);
      frappe.model.set_value(cdt, cdn, 'trims_order_quantity', null);
      frappe.model.set_value(cdt, cdn, 'required_quantity', null);
    } else {
      // ✅ Calculate required quantity
      const required_qty = flt(row.trims_order_quantity) * flt(row.per_unit_quantity);
      frappe.model.set_value(cdt, cdn, 'required_quantity', required_qty);
    }
  }
});