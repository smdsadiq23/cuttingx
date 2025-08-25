// Copyright (c) 2025, Cognitonx Logic India Private limited and contributors
// For license information, please see license.txt

frappe.ui.form.on('Line In', {
    onload: function(frm) {
        setup_bundle_order_filter(frm);
        setup_date_and_time_sync(frm);
    },
    refresh: function(frm) {
        setup_date_and_time_sync(frm);
    },
    bundle_order_no: function(frm) {
        if (!frm.doc.bundle_order_no) {
            frm.clear_table('table_line_in_item');
            frm.refresh_field('table_line_in_item');
            return;
        }

        frappe.call({
            method: 'cuttingx.cuttingx.doctype.line_in.line_in.get_bundles_from_bundle_creation',
            args: { bundle_creation: frm.doc.bundle_order_no },
            callback: function(r) {
                const bundles = r.message || [];

                if (!bundles.length) {
                    frappe.msgprint(__("No bundles found in Bundle Creation: {0}", [frm.doc.bundle_order_no]));
                    return;
                }

                frm.clear_table('table_line_in_item');
                bundles.forEach(bundle => {
                    const row = frm.add_child('table_line_in_item');
                    row.work_order = bundle.work_order;
                    row.sales_order = bundle.sales_order;
                    row.line_item_no = bundle.line_item_no;
                    row.size = bundle.size;
                    row.bundle_id = bundle.bundle_id;
                    row.line_in_quantity = bundle.unitsbundle;
                });

                frm.refresh_field('table_line_in_item');
                frappe.show_alert({
                    //message: __('Fetched {0} bundles', [bundles.length]),
                    indicator: 'green'
                }, 3);
            }
        });
    }
});

// Set query to exclude already used Bundle Creation docs
function setup_bundle_order_filter(frm) {
    frm.set_query('bundle_order_no', function() {
        return {
            query: 'cuttingx.cuttingx.doctype.line_in.line_in.get_unused_bundle_creations'
        };
    });
}

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

        frappe.show_alert(__('⏰ Time synced to all rows'), 2);
    });
}