// Copyright (c) 2025, Cognitonx Logic India Private limited and contributors
// For license information, please see license.txt

frappe.ui.form.on('Cutting Lay Record', {
    buyer: function(frm) {
        frm.set_value('ocn', '');
        frm.set_value('style', '');
        frm.set_value('colour', '');      

        if (!frm.doc.buyer) {
            frm.set_query('ocn', () => ({}));
            return;
        }

        frappe.call({
            method: 'cuttingx.cuttingx.doctype.cutting_lay_record.cutting_lay_record.sales_order_query_by_byyer',
            args: {
                doctype: 'Sales Order',
                txt: '',
                searchfield: 'name',
                start: 0,
                page_len: 2,
                filters: { customer: frm.doc.buyer }
            },
            callback: function(r) {
                const results = r.message || [];
                if (results.length === 1) {
                    frm.set_value('ocn', results[0][0]);
                }
                frm.set_query('ocn', () => {
                    return {
                        query: 'cuttingx.cuttingx.doctype.cutting_lay_record.cutting_lay_record.sales_order_query_by_byyer',
                        filters: { customer: frm.doc.buyer }
                    };
                });
            }
        });
    },

    ocn: function(frm) {
        frm.set_value('style', '');
        frm.set_value('colour', '');   

        if (!frm.doc.ocn) {
            frm.set_query('style', () => ({}));
            return;
        }

        frappe.call({
            method: 'cuttingx.cuttingx.doctype.cutting_lay_record.cutting_lay_record.get_styles_for_ocn',
            args: { sales_order: frm.doc.ocn },
            callback: function(r) {
                const styles = r.message || [];
                if (styles.length === 1) {
                    frm.set_value('style', styles[0]);
                }

                if (styles.length > 0) {
                    frm.set_query('style', () => {
                        return { filters: { name: ['in', styles] } };
                    });
                } else {
                    frm.set_query('style', () => ({}));
                    frappe.msgprint(__('No styles found for this Sales Order.'));
                }
            }
        });
    },

    style: function(frm) {
        frm.set_value('colour', '');
        frm.clear_table('table_lay_size_ratio');
        frm.refresh_field('table_lay_size_ratio');
        frm.clear_table('table_lay_roll_details');
        frm.refresh_field('table_lay_roll_details');
        frm.set_value('cut_no', '');
        frm.set_value('total_ratio_qty', '');
        frm.set_value('total_roll_weight', '');
        frm.set_value('total_no_of_lays', '');

        if (frm.doc.ocn && frm.doc.style) {
            frappe.call({
                method: 'cuttingx.cuttingx.doctype.cutting_lay_record.cutting_lay_record.get_colors_for_style_in_ocn',
                args: {
                    sales_order: frm.doc.ocn,
                    style: frm.doc.style
                },
                callback: function(r) {
                    const colors = r.message || [];
                    
                    // Always set the options (even if 0 or 1)
                    if (colors.length > 0) {
                        frm.set_df_property('colour', 'options', colors.join('\n'));
                        frm.refresh_field('colour');
                        
                        // Auto-select only if exactly one
                        if (colors.length === 1) {
                            frm.set_value('colour', colors[0]);
                        }
                    } else {
                        frm.set_df_property('colour', 'options', '');
                        frm.refresh_field('colour');
                        frappe.msgprint(__('No colors found for this style.'));
                    }
                }
            });
        } else {
            frm.set_df_property('colour', 'options', '');
            frm.refresh_field('colour');
        }
    },

    colour: function(frm) {
        // Always clear dependent data when colour changes (even if empty)
        frm.clear_table('table_lay_size_ratio');
        frm.clear_table('table_lay_roll_details');
        frm.set_value('cut_no', '');
        frm.set_value('total_ratio_qty', '');
        frm.set_value('total_roll_weight', '');
        frm.set_value('total_no_of_lays', '');

        // Only proceed if all required fields are filled
        if (frm.doc.buyer && frm.doc.ocn && frm.doc.style && frm.doc.colour) {
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
                        update_total_ratio_qty(frm); // in case ratios were pre-filled (unlikely, but safe)
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
                            row.roll_weight = grn.roll_weight;
                            row.width = grn.width;
                            row.dia = grn.dia;
                        });
                        frm.refresh_field('table_lay_roll_details');
                        update_roll_totals(frm); // 👈 critical: recalculate after auto-fill
                    }
                }
            });
        }
    }
});

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

function update_total_ratio_qty(frm) {
    let total = 0;
    if (frm.doc.table_lay_size_ratio && frm.doc.table_lay_size_ratio.length) {
        frm.doc.table_lay_size_ratio.forEach(row => {
            total += flt(row.ratio); // flt() safely converts to float
        });
    }
    frm.set_value('total_ratio_qty', total);
}

function update_roll_totals(frm) {
    let total_weight = 0;
    let total_lays = 0;

    // ✅ Use the correct fieldname: table_lay_roll_details
    if (frm.doc.table_lay_roll_details && frm.doc.table_lay_roll_details.length) {
        frm.doc.table_lay_roll_details.forEach(row => {
            total_weight += flt(row.roll_weight);
            total_lays += flt(row.no_of_lays);
            console.log(row.roll_weight);
        });
    }

    frm.set_value('total_roll_weight', total_weight);
    frm.set_value('total_no_of_lays', total_lays);
}