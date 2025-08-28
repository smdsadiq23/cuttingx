// Copyright (c) 2025, Cognitonx Logic India Private limited and contributors
// For license information, please see license.txt

frappe.ui.form.on('Line In', {
    onload: function(frm) {
        setup_date_and_time_sync(frm);
    },
    refresh: function(frm) {
        setup_date_and_time_sync(frm);
    },
    validate: function(frm) {
        const seen = new Set();
        const duplicates = [];

        frm.doc.table_line_in_item.forEach(row => {
            if (!row.bundle_id) return;

            if (seen.has(row.bundle_id)) {
                duplicates.push(row.bundle_id);
            } else {
                seen.add(row.bundle_id);
            }
        });

        if (duplicates.length > 0) {
            frappe.throw(__(
                'Cannot save: Duplicate Bundle IDs found: {0}',
                [frappe.utils.comma_and(duplicates)]
            ));
        }
    }    
}); 

frappe.ui.form.on('Line In Item', {
    bundle_id: function(frm, cdt, cdn) {
        const row = locals[cdt][cdn];
        const bundle_id = (row.bundle_id || '').trim();

        // ✅ Log safely
        console.log('Scanning bundle ID:', bundle_id);

        if (!bundle_id || bundle_id.length < 5) return;

        // ✅ Check for duplicate bundle_id
        const existing = frm.doc.table_line_in_item.filter(d => 
            d.bundle_id === bundle_id && d.name !== row.name
        );

        if (existing.length > 0) {
            frappe.msgprint({
                title: __('Duplicate Bundle ID'),
                message: __('Bundle ID <b>{0}</b> has already been scanned.', [bundle_id]),
                indicator: 'red'
            });
            frappe.model.set_value(cdt, cdn, 'bundle_id', '');
            return;
        }

        // ✅ Fetch bundle details
        frappe.call({
            method: 'cuttingx.cuttingx.doctype.line_in.line_in.get_bundle_details',
            args: { bundle_id: bundle_id },
            callback: function(r) {
                if (!r.message) {
                    frappe.msgprint(__('❌ No bundle found with ID: {0}', [bundle_id]));
                    frappe.model.set_value(cdt, cdn, 'bundle_id', '');  // Clear invalid
                    return;
                }

                const data = r.message;

                // ✅ Set fields
                frappe.model.set_value(cdt, cdn, 'work_order', data.work_order);
                frappe.model.set_value(cdt, cdn, 'sales_order', data.sales_order);
                frappe.model.set_value(cdt, cdn, 'line_item_no', data.line_item_no);
                frappe.model.set_value(cdt, cdn, 'size', data.size);
                frappe.model.set_value(cdt, cdn, 'line_in_quantity', data.line_in_quantity);

                // Refresh to reflect changes
                frm.refresh_field('line_in_item');
            }
        });
    }
});

// Sync date_and_time from first row to all others
function setup_date_and_time_sync(frm) {
    if (!frm.fields_dict.table_line_in_item) return;

    const grid = frm.fields_dict.table_line_in_item.grid;

    // Patch refresh to rebind events
    if (!grid.refresh_patched) {
        const original_refresh = grid.refresh;
        grid.refresh = function() {
            original_refresh.apply(this, arguments);
            bind_date_and_time_events(frm);
        };
        grid.refresh_patched = true;
    }

    bind_date_and_time_events(frm);
}

function bind_date_and_time_events(frm) {
    const grid = frm.fields_dict.table_line_in_item.grid;
    const $wrapper = $(grid.wrapper);

    $wrapper.off('change', 'input[data-fieldname="date_and_time"]');
    $wrapper.on('change', 'input[data-fieldname="date_and_time"]', function () {
        const $input = $(this);
        const row_index = $input.closest('.grid-row').index();

        // Only sync from first row
        if (row_index !== 0) return;

        const raw_value = $input.val();
        if (!raw_value) return;

        let dt;
        try {
            dt = frappe.datetime.user_to_obj(raw_value);
        } catch (e) {
            frappe.msgprint(__('Invalid date/time format. Use DD-MM-YYYY HH:mm'));
            return;
        }

        // Format as "YYYY-MM-DD HH:mm:ss"
        const pad = n => String(n).padStart(2, '0');
        const db_format = `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())} ` +
                          `${pad(dt.getHours())}:${pad(dt.getMinutes())}:${pad(dt.getSeconds())}`;

        console.log('Syncing time:', db_format);

        (frm.doc.table_line_in_item || []).forEach((row, idx) => {
            if (idx === 0) return;
            frappe.model.set_value(row.doctype, row.name, 'date_and_time', db_format);
        });

        //frappe.show_alert(__('⏰ Time synced to all rows'), 2);
    });
}