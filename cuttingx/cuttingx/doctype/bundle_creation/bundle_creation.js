// Copyright (c) 2025, Cognitonx Logic India Private limited and contributors
// For license information, please see license.txt

frappe.ui.form.on('Bundle Creation', {
    onload: function(frm) {
        frm.set_query('cut_docket_id', () => {
            return {
                filters: [
                    ['name', 'in', get_eligible_cut_dockets()]
                ]
            };
        });
    },
    refresh(frm) {
        protect_child_table(frm);
        if (!frm.custom_bundle_button_added) {
            frm.fields_dict.table_bundle_details.grid.add_custom_button(__('Create Bundles'), function () {

                // If the form is not yet saved (new), save it first
                if (!frm.doc.__islocal && frm.doc.name) {
                    // Already saved – proceed
                    generate_bundles(frm);
                } else {
                    // Save first, then proceed
                    frappe.confirm(
                        'This document must be saved before generating bundles. Do you want to save and continue?',
                        () => {
                            frm.save().then(() => {
                                generate_bundles(frm);
                            });
                        }
                    );
                }

            }, __('Actions'));

            frm.custom_bundle_button_added = true;
        }
    },
    cut_docket_id: function(frm) {
        frappe.after_ajax(() => {
            setTimeout(() => protect_child_table(frm), 100);
        });     
        if (!frm.doc.cut_docket_id) return;

        // frappe.call({
        //     method: 'cuttingx.cuttingx.doctype.bundle_creation.bundle_creation.get_sales_and_work_orders_from_docket',
        //     args: {
        //         cut_docket_id: frm.doc.cut_docket_id
        //     },
        //     callback: function(r) {
        //         if (r.message) {
        //             // Clear and fill sales orders
        //             frm.clear_table('sales_orders');
        //             (r.message.sales_orders || []).forEach(so => {
        //                 const row = frm.add_child('sales_orders');
        //                 row.sales_order = so;
        //             });

        //             // Clear and fill work orders
        //             frm.clear_table('work_orders');
        //             (r.message.work_orders || []).forEach(wo => {
        //                 const row = frm.add_child('work_orders');
        //                 row.work_order = wo;
        //             });

        //             frm.refresh_fields(['sales_orders', 'work_orders']);
        //         }
        //     }
        // });
        frappe.call({
            method: 'cuttingx.cuttingx.doctype.bundle_creation.bundle_creation.get_cut_confirmation_items_from_docket',
            args: {
                cut_docket_id: frm.doc.cut_docket_id
            },
            callback: function(r) {
                if (r.message) {
                    frm.clear_table('table_bundle_creation_item');

                    (r.message || []).forEach(row => {
                        const child = frm.add_child('table_bundle_creation_item');
                        child.work_order = row.work_order;
                        child.sales_order = row.sales_order;
                        child.line_item_no = row.line_item_no;
                        child.size = row.size;
                        child.cut_quantity = row.cut_quantity;
                    });

                    frm.refresh_field('table_bundle_creation_item');
                    //frappe.msgprint(__('Bundle items fetched from Cut Confirmation.'));
                }
            }
        });
    }
});

frappe.ui.form.on('Bundle Creation Item', {
    planned_quantity: function(frm, cdt, cdn) {
        const row = locals[cdt][cdn];
        if (row.planned_quantity < 0) {
            frappe.msgprint(__("Planned Quantity cannot be negative"));
            frappe.model.set_value(cdt, cdn, 'planned_quantity', 0);
        } else {
            calculate_bundles(frm, cdt, cdn);
        }
    },
    unitsbundle: function(frm, cdt, cdn) {
        const row = locals[cdt][cdn];
        if (row.unitsbundle < 0) {
            frappe.msgprint(__("Units per Bundle cannot be negative"));
            frappe.model.set_value(cdt, cdn, 'unitsbundle', 1);
        } else {
            calculate_bundles(frm, cdt, cdn);
        }
    },
    'Bundle Creation Item': function(frm, cdt, cdn) {
        // This runs on any change in the child table
        hide_add_delete_buttons(frm);
    }
});

// 🔍 Utility to fetch eligible Cut Dockets
function get_eligible_cut_dockets() {
    let eligible = [];

    frappe.call({
        method: 'cuttingx.cuttingx.doctype.bundle_creation.bundle_creation.get_eligible_cut_dockets',
        async: false,
        callback: function(r) {
            if (r.message) {
                eligible = r.message;
            }
        }
    });

    return eligible;
}

function calculate_bundles(frm, cdt, cdn) {
    const row = locals[cdt][cdn];

    const qty = row.planned_quantity || 0;
    const units = row.unitsbundle || 1;

    // Ceiling division
    const no_of_bundles = Math.ceil(qty / units);

    frappe.model.set_value(cdt, cdn, 'no_of_bundles', no_of_bundles);
}

function generate_bundles(frm) {
    frappe.call({
        method: 'cuttingx.cuttingx.doctype.bundle_creation.bundle_creation.generate_bundle_details',
        args: {
            docname: frm.doc.name
        },
        freeze: true,
        freeze_message: "Generating bundles...",
        callback: function (r) {
            if (!r.exc) {
                frappe.msgprint(__('✅ Bundles generated successfully.'));
                frm.reload_doc();
            } else {
                frappe.msgprint(__('❌ Failed to generate bundles. Check server logs.'));
            }
        }
    });
}

// Reusable function to hide buttons
function protect_child_table(frm) {
    if (frm.fields_dict.table_bundle_creation_item) {
        const childtable1 = frm.fields_dict.table_bundle_creation_item.grid;
        const childtable2 = frm.fields_dict.table_bundle_details.grid;

        // 1. ✅ Hide the "Add Row" button
        setTimeout(() => {
            if (childtable1 && childtable1.grid_buttons) {
                childtable1.grid_buttons.find('.grid-add-row').hide();
                childtable1.grid_buttons.find('.grid-remove-rows').hide();
                childtable2.grid_buttons.find('.grid-add-row').hide();
                childtable2.grid_buttons.find('.grid-remove-rows').hide();  
                hide_add_row_button(childtable1);
                hide_add_row_button(childtable2);
                // N  O  T    W  O  R  K  I  N  G
                // block_create_new_row(childtable1);    
                // block_create_new_row(childtable2);
                // block_tab_in_last_row(childtable1);
                // block_tab_in_last_row(childtable2);
            }
        }, 100);
    }
}

function hide_add_row_button(grid) {
    // Use patch to re-hide on every refresh
    if (!grid.refresh_patched) {
        const original_refresh = grid.refresh;
        grid.refresh = function () {
            original_refresh.apply(this, arguments);
            // Re-hide after refresh
            setTimeout(() => {
                const $btn = this.grid_buttons?.find('.grid-add-row');
                if ($btn) {
                    $btn.hide();
                    $btn.data('permanently-hidden', true);
                }
            }, 50);
        };
        grid.refresh_patched = true; // prevent double patching
    } else {
        // Just hide if already patched
        const $btn = grid.grid_buttons?.find('.grid-add-row');
        if ($btn) {
            $btn.hide();
            $btn.data('permanently-hidden', true);
        }
    }
}

// function block_create_new_row(grid) {
//     // Replace create_new_row with no-op
//     grid.create_new_row = function () {
//         console.log('🛑 Blocked: create_new_row called');
//         // Do nothing
//     };
// }

// function block_tab_in_last_row(grid, frm) {
//     const fieldname = 'table_bundle_creation_item';

//     // Remove existing listeners to avoid duplicates
//     grid.wrapper.off('keydown', 'input');

//     grid.wrapper.on('keydown', 'input', function (e) {
//         if (e.key !== 'Tab') return;

//         const $input = $(e.target);
//         const $row = $input.closest('.grid-row');
//         const $body = $input.closest('.grid-body');
//         const $rows = $body.find('.grid-row');

//         // Check if current row is the last one
//         if ($row.is($rows.last())) {
//             e.preventDefault(); // Prevent default behavior
//             e.stopPropagation(); // Stop event propagation

//             // Immediately remove any auto-created row
//             const doc_rows = frm.doc?.[fieldname] || [];
//             const grid_rows = grid.grid_rows || [];

//             if (grid_rows.length > doc_rows.length) {
//                 const new_row = grid_rows[grid_rows.length - 1];
//                 // Adjust fields: use meaningful ones from your doctype
//                 const isEmptyRow = !new_row.doc.item_code && !new_row.doc.qty;

//                 if (isEmptyRow) {
//                     cur_frm.delete_doc(fieldname, new_row.doc.name);
//                     grid.refresh();
//                 }
//             }

//             // Optionally, focus back to the last input
//             $input.focus();
//         }
//     });
// }

