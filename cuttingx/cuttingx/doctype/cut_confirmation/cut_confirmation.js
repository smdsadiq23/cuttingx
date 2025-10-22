// Copyright (c) 2025, CognitionX Logic India Private limited and contributors
// For license information, please see license.txt

// On form load: recalculate all rows
frappe.ui.form.on('Cut Confirmation', {
    setup(frm) {
        // Target the cut_po_number field
        const field = frm.fields_dict.cut_po_number;

        // Wait for field to be ready
        $(frm.wrapper).on('render_complete', () => {
            if (!field.$input) return;

            // Variable to hold scanned value
            let scannedValue = '';

            // Listen to keydown to catch Enter (13) or Tab (9) as delimiter
            field.$input.on('keydown', function (e) {
                // If Enter or Tab is pressed, process the scan
                if (e.which === 13 || e.which === 9) {  // 13 = Enter, 9 = Tab
                    e.preventDefault();

                    scannedValue = field.$input.val().trim();

                    if (scannedValue) {
                        // Validate if this is a valid Cut Docket
                        frappe.db.exists('Cut Docket', scannedValue)
                            .then(exists => {
                                if (exists) {
                                    frm.set_value('cut_po_number', scannedValue);
                                    // Optional: clear input if reusing scanner
                                    // field.$input.val('');
                                } else {
                                    frappe.toast({
                                        title: __('Invalid Barcode'),
                                        message: __('Cutting Kanban {0} not found', [scannedValue]),
                                        indicator: 'red',
                                        timeout: 3000
                                    });
                                    // Clear invalid input
                                    field.$input.val('');
                                }
                            });
                    }
                }
            });

            // Optional: also capture fast input without Enter (rare, but possible)
            let buffer = '';
            let timer;

            field.$input.on('keypress', function (e) {
                // Skip modifiers and non-printable
                if (e.which <= 31) return;

                buffer += String.fromCharCode(e.which);
                clearTimeout(timer);

                // Wait for input pause (~100ms)
                timer = setTimeout(() => {
                    if (buffer.length >= 4 && !field.get_value()) {
                        // Only act if not already set
                        frappe.db.exists('Cut Docket', buffer.trim())
                            .then(exists => {
                                if (exists) {
                                    frm.set_value('cut_po_number', buffer.trim());
                                }
                                buffer = '';
                            });
                    } else {
                        buffer = '';
                    }
                }, 100); // Adjust based on scanner speed
            });
        });
    },
    onload: function(frm) {
        // Try immediately
        focus_cut_po_field(frm);

        // Fallback: after a short delay (if field not ready)
        setTimeout(() => focus_cut_po_field(frm), 300);
        setTimeout(() => focus_cut_po_field(frm), 800);     

        // Set dynamic query with real-time exclusion
        frm.set_query('cut_po_number', () => {
            return {
                query: 'cuttingx.cuttingx.doctype.cut_confirmation.cut_confirmation.get_unused_cut_dockets',
                filters: {
                    current_doc: frm.doc.name || ''
                }
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
                        child.sales_order = row.sales_order;
                        child.line_item_no = row.line_item_no;
                        child.size = row.size;
                        child.planned_quantity = row.planned_quantity;
                        child.confirmed_quantity = row.planned_quantity;

                        if (typeof calculate_all === "function") {
                            calculate_all(frm, child.doctype, child.name);
                        }
                    });
                    frm.refresh_field('table_cut_confirmation_item');
                }
            }
        });

        // // Fetch associated Sales Orders
        // frappe.call({
        //     method: 'cuttingx.cuttingx.doctype.cut_confirmation.cut_confirmation.get_sales_orders_from_docket',
        //     args: {
        //         docket_name: frm.doc.cut_po_number
        //     },
        //     callback: function(r) {
        //         if (r.message) {
        //             frm.clear_table('sales_orders');
        //             (r.message || []).forEach(so => {
        //                 const row = frm.add_child('sales_orders');
        //                 row.sales_order = so;
        //             });
        //             frm.refresh_field('sales_orders');
        //         }
        //     }
        // });
    }
});

// // 🔍 Utility: Get already used Cut Dockets
// function get_already_used_dockets() {
//     let dockets = [];
//     frappe.call({
//         method: 'frappe.client.get_list',
//         async: false,
//         args: {
//             doctype: 'Cut Confirmation',
//             fields: ['cut_po_number'],
//             filters: {
//                 docstatus: ['!=', 2],  // Exclude cancelled
//                 cut_po_number: ['!=', null]
//             },
//             limit_page_length: 1000
//         },
//         callback: function(r) {
//             dockets = (r.message || []).map(row => row.cut_po_number);
//         }
//     });
//     return dockets;
// }

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

    const planned = parseFloat(d.planned_quantity) || 0;
    const confirmed = parseFloat(d.confirmed_quantity) || 0;
    const full_panel = parseFloat(d.full_panel_reject) || 0;
    const other = parseFloat(d.other_reject) || 0;

    // 🔒 Client-side validation: confirmed_quantity <= planned_quantity
    if (confirmed > planned) {
        frappe.show_alert({
            message: __('Confirmed Quantity cannot exceed Planned Quantity ({0})', [planned]),
            indicator: 'red'
        }, 5);
        // Reset to planned or 0 if invalid
        frappe.model.set_value(cdt, cdn, 'confirmed_quantity', planned);
        return; // Stop further calculation
    }

    const balance_to_confirm = parseFloat((planned - confirmed).toFixed(2));
    const total_reject = parseFloat((full_panel + other).toFixed(2));

    // Set calculated fields
    frappe.model.set_value(cdt, cdn, 'balance_to_confirm', balance_to_confirm);
    frappe.model.set_value(cdt, cdn, 'total_reject', total_reject);
}

// Reusable function to focus the field
function focus_cut_po_field(frm) {
    const field = frm.fields_dict.cut_po_number;
    if (!field) return;

    // Check if $input exists and is visible
    if (field.$input && field.$input.is(':visible') && field.$input.is(':enabled')) {
        field.$input.focus().select(); // focus + select any existing text
        console.log("✅ Focused cut_po_number field");
    } else {
        console.warn("⚠️ cut_po_number field not ready for focus");
    }
}



