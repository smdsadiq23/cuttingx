// Copyright (c) 2025, Cognitonx Logic India Private limited and contributors
// For license information, please see license.txt

// frappe.ui.form.on("Bundle Creation", {
// 	refresh(frm) {

// 	},
// });

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

function calculate_bundles(frm, cdt, cdn) {
    const row = locals[cdt][cdn];

    const qty = row.planned_quantity || 0;
    const units = row.unitsbundle || 1;

    // Ceiling division
    const no_of_bundles = Math.ceil(qty / units);

    frappe.model.set_value(cdt, cdn, 'no_of_bundles', no_of_bundles);
}

// Optional: Recalculate on form load
frappe.ui.form.on('Bundle Creation', {
    refresh: function(frm) {
        const fieldname = 'items';  // Replace with your actual child table fieldname
        (frm.doc[fieldname] || []).forEach(function(row) {
            calculate_bundles(frm, row.doctype, row.name);
        });
    }
});
