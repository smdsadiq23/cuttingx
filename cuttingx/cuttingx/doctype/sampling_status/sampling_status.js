// Copyright (c) 2025, Cognitonx Logic India Private limited and contributors
// For license information, please see license.txt

frappe.ui.form.on('Sampling Status', {
    refresh: function(frm) {
        calculate_and_set_percentages(frm);
        calculate_total_panel_weight_and_knitting_time(frm);
    }
});

frappe.ui.form.on('Sampling Status Consumption', {
    weight: function(frm, cdt, cdn) {
        calculate_and_set_percentages(frm);
    },
    table_sampling_status_consumption_remove: function(frm) {
        calculate_and_set_percentages(frm);
    }
});

frappe.ui.form.on('Sampling Status Panels', {
    weight: function(frm, cdt, cdn) {
        calculate_total_panel_weight_and_knitting_time(frm);
    },
    knitting_time: function(frm, cdt, cdn) {
        const row = locals[cdt][cdn];
        let value = row.knitting_time;

        if (value) {
            // Allow MM:SS or M:SS or MM:S etc.
            const validFormat = /^([0-5]?\d):([0-5]?\d)$/.test(value);
            if (!validFormat) {
                frappe.msgprint({
                    title: __("Invalid Time Format"),
                    message: __("Please enter time in MM:SS format (e.g., 15:30)."),
                    indicator: "orange"
                });
                frappe.model.set_value(cdt, cdn, "knitting_time", "");
            }
        }

        // Recalculate totals after validation
        calculate_total_panel_weight_and_knitting_time(frm);
    },    
    table_sampling_status_panels_remove: function(frm) {
        calculate_total_panel_weight_and_knitting_time(frm);
    }
});

function calculate_and_set_percentages(frm) {
    // Step 1: Calculate total weight
    let total = 0;
    if (frm.doc.table_sampling_status_consumption) {
        frm.doc.table_sampling_status_consumption.forEach(row => {
            total += flt(row.weight);
        });
    }

    // Set total (this may trigger other logic, but it's safe)
    frm.set_value('total_consumption_weight', total);

    // Step 2: Update percentage for each row
    if (frm.doc.table_sampling_status_consumption && total > 0) {
        frm.doc.table_sampling_status_consumption.forEach(row => {
            const pct = (flt(row.weight) / total) * 100;
            // Only update if changed to avoid unnecessary triggers
            if (Math.abs(flt(row.percentage) - pct) > 0.01) {
                frappe.model.set_value(row.doctype, row.name, 'percentage', flt(pct, 2));
            }
        });
    } else if (frm.doc.table_sampling_status_consumption) {
        // If total is 0, set all percentages to 0
        frm.doc.table_sampling_status_consumption.forEach(row => {
            if (flt(row.percentage) !== 0) {
                frappe.model.set_value(row.doctype, row.name, 'percentage', 0);
            }
        });
    }
}

function calculate_total_panel_weight_and_knitting_time(frm) {
    let total_weight = 0;
    let total_seconds = 0;

    if (frm.doc.table_sampling_status_panels) {
        frm.doc.table_sampling_status_panels.forEach(row => {
            total_weight += flt(row.weight);
            total_seconds += mmssToSeconds(row.knitting_time);
        });
    }

    // Convert total seconds back to MM:SS (or HH:MM:SS if >59 min)
    const total_time_str = secondsToMMSSorHHMMSS(total_seconds);

    frm.set_value('total_panel_weight', total_weight);
    frm.set_value('total_knitting_time', total_time_str);
}

// Convert "MM:SS" → seconds
function mmssToSeconds(timeStr) {
    if (!timeStr) return 0;
    const parts = timeStr.split(':').map(Number);
    if (parts.length !== 2) return 0;
    const minutes = parts[0] || 0;
    const seconds = parts[1] || 0;
    return minutes * 60 + seconds;
}

// Convert total seconds → "MM:SS" if < 60 min, else "HH:MM:SS"
function secondsToMMSSorHHMMSS(totalSeconds) {
    if (totalSeconds <= 0) return "00:00";

    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    const pad = (num) => String(num).padStart(2, '0');

    if (hours > 0) {
        // Show as HH:MM:SS if total >= 60 minutes
        return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
    } else {
        // Show as MM:SS
        return `${pad(minutes)}:${pad(seconds)}`;
    }
}