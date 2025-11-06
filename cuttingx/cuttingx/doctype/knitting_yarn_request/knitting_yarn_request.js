// Copyright (c) 2025, Cognitonx Logic India Private Limited and contributors
// For license information, please see license.txt

frappe.ui.form.on('Knitting Yarn Request', {
    onload: function(frm) {
        set_yarn_code_query_safely(frm);
    },

    refresh: function(frm) {
        if (frm.doc.docstatus === 0) {
            frm.page.set_indicator(__('Requested'), 'orange');
        } else if (frm.doc.docstatus === 1) {
            frm.page.set_indicator(__('Issued'), 'green');
        }        
        const is_yarn_approver = frappe.user.has_role('Yarn Approver');
        const is_allowed_status = (frm.doc.docstatus === 0) 
        const readonly = ! (is_yarn_approver && is_allowed_status);
        frm.set_df_property('table_yarn_shade_distribution', 'read_only', readonly);
    },

    work_order: function(frm) {
        if (!frm.doc.work_order) {
            frm.set_value('sales_order', '');
            frm.set_value('style', '');
            frm.set_value('total_garment_qty', '');
            frm.clear_table('table_yarn_size_distribution');
            frm.refresh_field('table_yarn_size_distribution');
            frm.clear_table('table_yarn_shade_distribution');
            frm.refresh_field('table_yarn_shade_distribution');
            frm.set_value('total_bom_consumption', 0);
            frm.set_value('total_yarn_requirement', 0);
            return;
        }

        frappe.db.get_doc('Work Order', frm.doc.work_order)
            .then(wo_doc => {
                // 1. Sales Order
                const first_so = wo_doc.custom_sales_orders?.length > 0 
                    ? wo_doc.custom_sales_orders[0].sales_order 
                    : '';
                frm.set_value('sales_order', first_so);

                // 2. Total Garment Qty
                frm.set_value('total_garment_qty', flt(wo_doc.qty));

                // 3. Style
                const production_item = wo_doc.production_item;
                if (production_item) {
                    frappe.db.get_value('Item', production_item, 'custom_style_master')
                        .then(r => {
                            const style = r.message?.custom_style_master || '';
                            frm.set_value('style', style);
                        })
                        .catch(() => frm.set_value('style', ''));
                } else {
                    frm.set_value('style', '');
                }

                // 4. Yarn Size Distribution
                if (wo_doc.custom_work_order_line_items?.length > 0) {
                    frm.clear_table('table_yarn_size_distribution');
                    wo_doc.custom_work_order_line_items.forEach(line_item => {
                        if (line_item.size && line_item.work_order_allocated_qty) {
                            let row = frm.add_child('table_yarn_size_distribution');
                            row.size = line_item.size;
                            row.quantity = flt(line_item.work_order_allocated_qty);
                        }
                    });
                    frm.refresh_field('table_yarn_size_distribution');
                } else {
                    frm.clear_table('table_yarn_size_distribution');
                    frm.refresh_field('table_yarn_size_distribution');
                }

                // ✅ 5. AUTO-FILL YARN SHADE DISTRIBUTION FROM BOM
                frappe.call({
                    method: 'cuttingx.cuttingx.doctype.knitting_yarn_request.knitting_yarn_request.get_yarns_from_work_order_bom',
                    args: { work_order: frm.doc.work_order },
                    callback: function(r) {
                        frm.clear_table('table_yarn_shade_distribution');
                        if (r.message && Array.isArray(r.message)) {
                            r.message.forEach(yarn => {
                                let row = frm.add_child('table_yarn_shade_distribution');
                                row.yarn_code = yarn.yarn_code;
                                row.yarn_shade = yarn.yarn_shade;
                                row.yarn_count = yarn.yarn_count;
                                row.bom_consumption = flt(yarn.bom_consumption);
                            });
                        }
                        frm.refresh_field('table_yarn_shade_distribution');
                        // Trigger recalc of yarn_required and totals
                        setTimeout(() => recalculate_yarn_shade_table(frm), 100);
                    }
                });
            })
            .catch(err => {
                console.warn('Failed to fetch Work Order:', frm.doc.work_order, err);
                frm.set_value('sales_order', '');
                frm.set_value('style', '');
                frm.set_value('total_garment_qty', '');
                frm.clear_table('table_yarn_size_distribution');
                frm.refresh_field('table_yarn_size_distribution');
                frm.set_value('total_bom_consumption', 0);
                frm.set_value('total_yarn_requirement', 0);
                frm.set_value('total_yarn_issued', 0);
            });
    },

    total_garment_qty: function(frm) {
        recalculate_yarn_shade_table(frm);
    },
});

// // Yarn Shade Distribution child table handlers
// frappe.ui.form.on('Yarn Shade Distribution', {
//     yarn_code: function(frm, cdt, cdn) {
//         const yarn_item = locals[cdt][cdn].yarn_code;

//         if (!yarn_item) {
//             frappe.model.set_value(cdt, cdn, 'bom_consumption', 0);
//             return;
//         }

//         frappe.call({
//             method: 'cuttingx.cuttingx.doctype.knitting_yarn_request.knitting_yarn_request.get_bom_consumption_for_yarn',
//             args: { yarn_code: yarn_item },
//             callback: function(r) {
//                 const qty = flt(r.message || 0);
//                 frappe.model.set_value(cdt, cdn, 'bom_consumption', qty);
//             }
//         });
//     },

//     bom_consumption: function(frm, cdt, cdn) {
//         const row = locals[cdt][cdn];
//         const total_qty = flt(frm.doc.total_garment_qty);
//         const consumption = flt(row.bom_consumption);
//         frappe.model.set_value(cdt, cdn, 'yarn_required', consumption * total_qty)
//             .then(() => {
//                 update_yarn_shade_totals(frm);
//             });
//     },

//     table_yarn_shade_distribution_add: function(frm) {
//         setTimeout(() => recalculate_yarn_shade_table(frm), 100);
//     },

//     table_yarn_shade_distribution_remove: function(frm) {
//         update_yarn_shade_totals(frm);
//     }
// });

frappe.ui.form.on('Yarn Shade Distribution', {
    yarn_issued: function(frm, cdt, cdn) {
        let total = 0;
        (frm.doc.table_yarn_shade_distribution || []).forEach(row => {
            total += flt(row.yarn_issued);
        });
        frm.set_value('total_yarn_issued', total);
    }
});

// ✅ Safe query setter (won't mark doc as dirty)
function set_yarn_code_query_safely(frm) {
    const grid_field = frm.get_field("table_yarn_shade_distribution");
    if (grid_field && grid_field.grid) {
        grid_field.grid.get_field("yarn_code").get_query = function() {
            return {
                filters: {
                    custom_select_master: "Yarns"
                }
            };
        };
    }
}

// Recalculate entire yarn shade table + totals
function recalculate_yarn_shade_table(frm) {
    const total_qty = flt(frm.doc.total_garment_qty);
    let promises = [];

    (frm.doc.table_yarn_shade_distribution || []).forEach(row => {
        const consumption = flt(row.bom_consumption);
        const yarn_required = consumption * total_qty;
        if (flt(row.yarn_required) !== yarn_required) {
            promises.push(
                frappe.model.set_value(row.doctype, row.name, 'yarn_required', yarn_required)
            );
        }
    });

    Promise.all(promises).then(() => {
        update_yarn_shade_totals(frm);
    });
}

// Update total_bom_consumption and total_yarn_requirement
function update_yarn_shade_totals(frm) {
    let total_bom = 0;
    let total_yarn_required = 0;

    (frm.doc.table_yarn_shade_distribution || []).forEach(row => {
        total_bom += flt(row.bom_consumption);
        total_yarn_required += flt(row.yarn_required);
    });

    frm.set_value('total_bom_consumption', total_bom);
    frm.set_value('total_yarn_requirement', total_yarn_required);
}