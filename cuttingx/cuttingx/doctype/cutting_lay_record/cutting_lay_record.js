// Copyright (c) 2025, Cognitonx Logic India Private limited and contributors
// For license information, please see license.txt

frappe.ui.form.on('Cutting Lay Record', {
    cut_kanban_no: function(frm) {
        // Clear all dependent data
        frm.clear_table('table_lay_size_ratio');
        frm.clear_table('table_lay_roll_details');
        ['cut_no', 'total_ratio_qty', 'total_roll_weight', 'total_no_of_lays', 'average_consumption'].forEach(field => {
            frm.set_value(field, '');
        });

        if (!frm.doc.cut_kanban_no) {
            // Clear linked fields if kanban is cleared
            ['ocn', 'style', 'colour'].forEach(field => frm.set_value(field, ''));
            return;
        }

        // Fetch ocn (from child), style & colour (from parent) in one call
        frappe.call({
            method: 'cuttingx.cuttingx.doctype.cutting_lay_record.cutting_lay_record.get_cut_docket_details',
            args: { cut_kanban_no: frm.doc.cut_kanban_no },
            callback: function(r) {
                if (r.message) {
                    const { ocn, style, colour } = r.message;
                    // Set all three fields
                    frm.set_value('ocn', ocn || '');
                    frm.set_value('style', style || '');
                    frm.set_value('colour', colour || '');
                    // Trigger colour handler AFTER all are set
                    frm.trigger('colour');
                } else {
                    // Clear fields on failure
                    ['ocn', 'style', 'colour'].forEach(field => frm.set_value(field, ''));
                    frappe.msgprint(__('Cut Docket not found or missing required data.'));
                }
            }
        });
    },

    // Optional: handle manual changes to colour (e.g., if field is editable)
    colour: function(frm) {
        // Clear dependent tables and computed fields
        frm.clear_table('table_lay_size_ratio');
        frm.clear_table('table_lay_roll_details');
        ['cut_no', 'total_ratio_qty', 'total_roll_weight', 'total_no_of_lays'].forEach(field => {
            frm.set_value(field, '');
        });

        // Proceed only when ALL required fields are present
        if (frm.doc.ocn && frm.doc.style && frm.doc.colour) {
            // 1. Auto-fill cut_no
            frappe.call({
                method: 'cuttingx.cuttingx.doctype.cutting_lay_record.cutting_lay_record.get_next_cut_no',
                args: {
                    buyer: frm.doc.buyer,
                    ocn: frm.doc.ocn,
                    style: frm.doc.style,
                    colour: frm.doc.colour
                },
                callback: function(r) {
                    if (r.message) {
                        frm.set_value('cut_no', r.message);
                    }
                }
            });

            // 2. Populate Lay Size Ratio
            frappe.call({
                method: 'cuttingx.cuttingx.doctype.cutting_lay_record.cutting_lay_record.get_sizes_for_ocn',
                args: {
                    sales_order: frm.doc.ocn,
                    style: frm.doc.style,
                    colour: frm.doc.colour
                },
                callback: function(r) {
                    const sizes = r.message || [];
                    if (sizes.length > 0) {
                        sizes.forEach(size => {
                            let row = frm.add_child('table_lay_size_ratio');
                            row.size = size;
                        });
                        frm.refresh_field('table_lay_size_ratio');
                        update_total_ratio_qty(frm);
                    }
                }
            });

            // 3. Populate Lay Roll Details
            frappe.call({
                method: 'cuttingx.cuttingx.doctype.cutting_lay_record.cutting_lay_record.get_grn_items_for_style_colour',
                args: {
                    sales_order: frm.doc.ocn,
                    style: frm.doc.style,
                    colour: frm.doc.colour
                },
                callback: function(r) {
                    const grn_items = r.message || [];
                    if (grn_items.length > 0) {
                        grn_items.forEach(grn => {
                            let row = frm.add_child('table_lay_roll_details');
                            row.grn_item_reference = grn.grn_item_reference;
                            row.roll_no = grn.roll_no;
                            row.roll_weight = grn.roll_weight;
                            row.width = grn.width;
                            row.dia = grn.dia;
                        });
                        frm.refresh_field('table_lay_roll_details');
                        update_roll_totals(frm);
                        update_average_consumption(frm);
                    }
                }
            });
        }
    }
});

// Child table: Lay Size Ratio
frappe.ui.form.on('Lay Size Ratio', {
    ratio: function(frm) {
        update_total_ratio_qty(frm);
    },
    table_lay_size_ratio_remove: function(frm) {
        update_total_ratio_qty(frm);
    },
    table_lay_size_ratio_add: function(frm) {
        update_total_ratio_qty(frm);
    }
});

// Child table: Lay Roll Details
frappe.ui.form.on('Lay Roll Details', {
    roll_weight: function(frm) {
        update_roll_totals(frm);
    },
    no_of_lays: function(frm) {
        update_roll_totals(frm);
    },
    lay_roll_details_remove: function(frm) {
        update_roll_totals(frm);
    },
    lay_roll_details_add: function(frm) {
        update_roll_totals(frm);
    }
});

// Utility Functions
function update_total_ratio_qty(frm) {
    let total = 0;
    if (frm.doc.table_lay_size_ratio && frm.doc.table_lay_size_ratio.length) {
        frm.doc.table_lay_size_ratio.forEach(row => {
            total += flt(row.ratio);
        });
    }
    frm.set_value('total_ratio_qty', total);
    update_average_consumption(frm);
}

function update_roll_totals(frm) {
    let total_weight = 0;
    let total_lays = 0;
    if (frm.doc.table_lay_roll_details && frm.doc.table_lay_roll_details.length) {
        frm.doc.table_lay_roll_details.forEach(row => {
            total_weight += flt(row.roll_weight);
            total_lays += flt(row.no_of_lays);
        });
    }
    frm.set_value('total_roll_weight', total_weight);
    frm.set_value('total_no_of_lays', total_lays);
    update_average_consumption(frm);
}

function update_average_consumption(frm) {
    const total_roll_weight = flt(frm.doc.total_roll_weight);
    const total_no_of_lays = flt(frm.doc.total_no_of_lays);
    const total_ratio_qty = flt(frm.doc.total_ratio_qty);

    let avg_consumption = 0;
    if (total_no_of_lays > 0 && total_ratio_qty > 0) {
        avg_consumption = total_roll_weight / (total_no_of_lays * total_ratio_qty);
    }
    frm.set_value('average_consumption', avg_consumption);
}