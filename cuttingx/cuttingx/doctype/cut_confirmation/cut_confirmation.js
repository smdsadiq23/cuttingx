// Copyright (c) 2025, CognitionX Logic India Private limited and contributors
// For license information, please see license.txt

// frappe.ui.form.on("Cut Confirmation", {
//  refresh(frm) {

//  },
// });

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

// On form load: recalculate all rows
frappe.ui.form.on('Cut Confirmation', {
    refresh: function(frm) {
        console.log("🔄 Form refresh triggered");

        // 🔁 REPLACE 'items' WITH YOUR ACTUAL CHILD TABLE FIELDNAME
        const fieldname = 'cut_confirmation_items';  // ← CHANGE THIS!

        if (!frm.doc[fieldname]) {
            console.log("⚠️ No rows found in", fieldname);
            return;
        }

        frm.doc[fieldname].forEach(function(row) {
            calculate_all(frm, row.doctype, row.name);
        });

        console.log("✅ All rows recalculated");
    }
});

