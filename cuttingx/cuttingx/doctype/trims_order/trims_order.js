frappe.ui.form.on('Trims Order', {
  onload(frm) {
    frm.get_field('table_trims_order_details').grid.cannot_add_rows = true;
    frm.get_field('table_trims_order_summary').grid.cannot_add_rows = true;
  },
  work_order(frm) {
    // 🔄 Case 1: Work Order is cleared
    if (!frm.doc.work_order) {
      frm.clear_table("table_trims_order_details");
      frm.refresh_field("table_trims_order_details");

      if (frm.doc.table_trims_order_summary) {
        frm.clear_table("table_trims_order_summary");
        frm.refresh_field("table_trims_order_summary");
      }

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

    if (frm.doc.table_trims_order_summary) {
      frm.clear_table("table_trims_order_summary");
      frm.refresh_field("table_trims_order_summary");
    }    

    // ✅ Try to fetch from existing trims records
    frappe.call({
      method: "cuttingx.cuttingx.doctype.trims_order.trims_order.get_grouped_trims_data",
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
              wo_quantity: row.wo_quantity
            });
          });
          frm.refresh_field("table_trims_order_details");
          // After details are filled, build summary
          fetch_and_fill_summary(frm);
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
                    wo_quantity: row.wo_quantity
                  });
                });
                frm.refresh_field("table_trims_order_details");
              }
              // After fallback details, build summary (fallback path will also fallback)
              fetch_and_fill_summary(frm);
            }
          });
        }
      }
    });
  }, 
  // before_save(frm) {
  //   (frm.doc.table_trims_order_details || []).forEach((row, idx) => {
  //     if (!row.table_trims_order_summary || flt(row.table_trims_order_summary) === 0) {
  //       frappe.throw(
  //         `<b>Trims Order Quantity</b> cannot be greater than <b>WO Quantity</b> for row <b>${idx + 1}</b> ` +
  //         `(Sales Order: <b>${row.sales_order || "?"}</b>, Size: <b>${row.size || "?"}</b>)`
  //       );
  //     }
  //   });
  // }
});

// --- Summary table validation & propagation ---
frappe.ui.form.on("Trims Order Summary", {
  trims_order_quantity(frm, cdt, cdn) {
    const srow = locals[cdt][cdn];

    // Available = WO Qty − Already Issued Qty (from the summary row itself)
    const available = flt(srow.wo_quantity) - flt(srow.already_issued_quantity);
    const entered = flt(srow.trims_order_quantity);

    if (entered > available) {
      frappe.msgprint(
        __("Trims Order Quantity cannot be greater than <b>WO Quantity − Already Issued Quantity</b>.<br>Available: <b>{0}</b>", [available])
      );
      // clamp to available (or set null if you prefer)
      frappe.model.set_value(cdt, cdn, "trims_order_quantity", available);
    }

    // Recalculate only details matching this (sales_order, size)
    const matches = (frm.doc.table_trims_order_details || []).filter(
      r => (r.sales_order || "") === (srow.sales_order || "") &&
           (r.size || "") === (srow.size || "")
    );

    matches.forEach(r => recalc_required_for_detail_row(frm, r));
    frm.refresh_field("table_trims_order_details");
  },

  // If keys change, recompute all
  sales_order(frm) { recalc_required_for_all_details(frm); },
  size(frm) { recalc_required_for_all_details(frm); },
});

/**
 * Fetch & fill the SUMMARY table.
 * Tries grouped summary first; if empty, falls back to BOM-based summary.
 * Expected summary schema: size, wo_quantity
 * Replace 'table_trims_order_summary' & fieldnames if yours differ.
 */
function fetch_and_fill_summary(frm) {
  // If the form doesn't have a summary table, skip quietly
  if (!frm.fields_dict.table_trims_order_summary) return;

  // Clear existing summary rows
  frm.clear_table("table_trims_order_summary");
  frm.refresh_field("table_trims_order_summary");

  // Primary: grouped summary
  frappe.call({
    method: "cuttingx.cuttingx.doctype.trims_order.trims_order.get_grouped_trims_summary_data",
    args: { work_order: frm.doc.work_order },
    callback: function (r) {
      if (r.message && r.message.length > 0) {
        r.message.forEach(row => {
          frm.add_child("table_trims_order_summary", {
            sales_order: row.sales_order,
            size: row.size,
            wo_quantity: row.wo_quantity,
            already_issued_quantity: row.already_issued_quantity
          });
        });
        frm.refresh_field("table_trims_order_summary");
      } else {
        // Fallback summary (BOM)
        frappe.call({
          method: "cuttingx.cuttingx.doctype.trims_order.trims_order.get_fallback_summary_trims",
          args: { work_order: frm.doc.work_order },
          callback: function (r2) {
            if (r2.message && r2.message.length > 0) {
              r2.message.forEach(row => {
                frm.add_child("table_trims_order_summary", {
                  sales_order: row.sales_order,
                  size: row.size,
                  wo_quantity: row.wo_quantity,
                  already_issued_quantity: "0"
                });
              });
              frm.refresh_field("table_trims_order_summary");
            }
          }
        });
      }
    }
  });
}


function find_summary_qty(frm, sales_order, size) {
  // returns numeric trims_order_quantity for (sales_order, size), else 0
  const list = frm.doc.table_trims_order_summary || [];
  const match = list.find(
    r =>
      (r.sales_order || "") === (sales_order || "") &&
      (r.size || "") === (size || "")
  );
  return flt(match ? match.trims_order_quantity : 0);
}

function recalc_required_for_detail_row(frm, row) {
  const summary_qty = find_summary_qty(frm, row.sales_order, row.size);
  const per_unit = flt(row.per_unit_quantity);
  const required = per_unit * summary_qty;
  row.required_quantity = required;
}

function recalc_required_for_all_details(frm) {
  (frm.doc.table_trims_order_details || []).forEach(row => {
    recalc_required_for_detail_row(frm, row);
  });
  frm.refresh_field("table_trims_order_details");
}
