// Copyright (c) 2025, CognitionX Logic India Private limited and contributors
// For license information, please see license.txt

// On form load: recalculate all rows
frappe.ui.form.on('Cut Confirmation', {
    cut_po_number: function(frm) {
        if (!frm.doc.cut_po_number) return;

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

                        // Optional: Trigger field calculations
                        if (typeof calculate_all === "function") {
                            calculate_all(frm, child.doctype, child.name);
                        }
                    });

                    frm.refresh_field('table_cut_confirmation_item');
                    // frappe.msgprint(__('Cut Confirmation Items fetched based on Cut PO.'));
                }
            }
        });
    }
});



frappe.ui.form.on('Cut Confirmation', {
    refresh: function(frm) {

    }
});

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



