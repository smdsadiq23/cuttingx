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
        if (!frm.doc.cut_docket_id) return;

        frappe.call({
            method: 'cuttingx.cuttingx.doctype.bundle_creation.bundle_creation.get_sales_and_work_orders_from_docket',
            args: {
                cut_docket_id: frm.doc.cut_docket_id
            },
            callback: function(r) {
                if (r.message) {
                    // Clear and fill sales orders
                    frm.clear_table('sales_orders');
                    (r.message.sales_orders || []).forEach(so => {
                        const row = frm.add_child('sales_orders');
                        row.sales_order = so;
                    });

                    // Clear and fill work orders
                    frm.clear_table('work_orders');
                    (r.message.work_orders || []).forEach(wo => {
                        const row = frm.add_child('work_orders');
                        row.work_order = wo;
                    });

                    frm.refresh_fields(['sales_orders', 'work_orders']);
                }
            }
        });
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
        if (row.unitsbundle <= 0) {
            frappe.msgprint(__("Units per Bundle must be greater than 0"));
            frappe.model.set_value(cdt, cdn, 'unitsbundle', 1);
        } else {
            calculate_bundles(frm, cdt, cdn);
        }
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
