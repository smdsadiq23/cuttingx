// Copyright (c) 2025, CognitionX Logic India Private limited and contributors
// For license information, please see license.txt

// On form load: recalculate all rows
frappe.ui.form.on('Cut Confirmation', {
    onload: function(frm) {
        // Set filter to exclude already used Cut Dockets
        frm.set_query('cut_po_number', () => {
            return {
                filters: [
                    ['docstatus', '=', 1],  // Only submitted
                    ['name', 'not in', get_already_used_dockets()]
                ]
            };
        });
    },
    cut_po_number: function(frm) {
        if (!frm.doc.cut_po_number) return;

        // Fetch Cut Confirmation Items
        frappe.call({
            method: 'cuttingx.cuttingx.doctype.cut_confirmation.cut_confirmation.get_items_from_cut_docket',
            args: {
                cut_po_number: frm.doc.cut_po_number
            },
            callback: function(r) {
                if (r.message) {
                    frm.clear_table('table_cut_confirmation_item');
                    (r.message || []).forEach(row => {
                        let child = frm.add_child('table_cut_confirmation_item');
                        child.work_order = row.work_order;
                        child.size = row.size;
                        child.planned_quantity = row.planned_quantity;

                        if (typeof calculate_all === "function") {
                            calculate_all(frm, child.doctype, child.name);
                        }
                    });
                    frm.refresh_field('table_cut_confirmation_item');
                }
            }
        });

        // Fetch associated Sales Orders
        frappe.call({
            method: 'cuttingx.cuttingx.doctype.cut_confirmation.cut_confirmation.get_sales_orders_from_docket',
            args: {
                docket_name: frm.doc.cut_po_number
            },
            callback: function(r) {
                if (r.message) {
                    frm.clear_table('sales_orders');
                    (r.message || []).forEach(so => {
                        const row = frm.add_child('sales_orders');
                        row.sales_order = so;
                    });
                    frm.refresh_field('sales_orders');
                }
            }
        });
    }
});

// 🔍 Utility: Get already used Cut Dockets
function get_already_used_dockets() {
    let dockets = [];
    frappe.call({
        method: 'frappe.client.get_list',
        async: false,
        args: {
            doctype: 'Cut Confirmation',
            fields: ['cut_po_number'],
            filters: {
                docstatus: ['!=', 2],  // Exclude cancelled
                cut_po_number: ['!=', null]
            },
            limit_page_length: 1000
        },
        callback: function(r) {
            dockets = (r.message || []).map(row => row.cut_po_number);
        }
    });
    return dockets;
}

frappe.ui.form.on('Cut Confirmation Item', {
    
    planned_quantity: function(frm, cdt, cdn) {
        console.log("🔢 planned_quantity changed", locals[cdt][cdn]);
        calculate_all(frm, cdt, cdn);
    },
    confirmed_quantity: function(frm, cdt, cdn) {
        console.log("🔢 confirmed_quantity changed", locals[cdt][cdn]);
        calculate_all(frm, cdt, cdn);
    },
    full_panel_reject: function(frm, cdt, cdn) {
        console.log("🗑️ full_panel_reject changed", locals[cdt][cdn]);
        calculate_all(frm, cdt, cdn);
    },
    other_reject: function(frm, cdt, cdn) {
        console.log("🗑️ other_reject changed", locals[cdt][cdn]);
        calculate_all(frm, cdt, cdn);
    }
});

function calculate_all(frm, cdt, cdn) {
    const d = locals[cdt][cdn];

    // Log the row data
    console.log("🔁 Calculating for row:", d);

    const planned = parseFloat(d.planned_quantity) || 0;
    const confirmed = parseFloat(d.confirmed_quantity) || 0;
    const full_panel = parseFloat(d.full_panel_reject) || 0;
    const other = parseFloat(d.other_reject) || 0;

    const balance_to_confirm = parseFloat((planned - confirmed).toFixed(2));
    const total_reject = parseFloat((full_panel + other).toFixed(2));

    console.log("✅ Calculated:", { balance_to_confirm, total_reject });

    // Set values
    frappe.model.set_value(cdt, cdn, 'balance_to_confirm', balance_to_confirm);
    frappe.model.set_value(cdt, cdn, 'total_reject', total_reject);
}



