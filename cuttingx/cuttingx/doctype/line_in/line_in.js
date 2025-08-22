// Copyright (c) 2025, Cognitonx Logic India Private limited and contributors
// For license information, please see license.txt

frappe.ui.form.on('Line In', {
    refresh: function(frm) {
        // Re-apply event listener when form refreshes
        setup_date_and_time_sync(frm);
    },
    onload: function(frm) {
        frm.set_query('bundle_order_no', function() {
            return {
                filters: {
                    docstatus: 0,  // Only draft (not submitted)
                    name: ['!=', '']
                }
            };
        });        
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
            // ^ Update path: your_app = cuttingx, your_module = e.g. doctype.line_in or custom_folder
            args: {
                bundle_creation: frm.doc.bundle_order_no
            },
            callback: function(r) {
                const bundles = r.message || [];

                if (!bundles.length) {
                    frappe.msgprint(__("No bundles found in Bundle Creation: {0}", [frm.doc.bundle_order_no]));
                    return;
                }

                frm.clear_table('table_line_in_item');

                for (const bundle of bundles) {
                    const row = frm.add_child('table_line_in_item');
                    row.work_order = bundle.work_order;
                    row.sales_order = bundle.sales_order;
                    row.line_item_no = bundle.line_item_no;
                    row.size = bundle.size;                  
                    row.bundle_id = bundle.bundle_id;
                    row.line_in_quantity = bundle.unitsbundle;

                    // Add more fields if needed
                }

                frm.refresh_field('table_line_in_item');
                //frappe.msgprint(__('✅ Fetched {0} bundles from {1}', [bundles.length, frm.doc.bundle_order_no]));
            }
        });
    }
});

function setup_date_and_time_sync(frm) {
    // Only proceed if table exists
    if (!frm.fields_dict.table_line_in_item) return;

    const grid = frm.fields_dict.table_line_in_item.grid;

    // Patch the refresh method to re-bind events
    if (!grid.refresh_patched) {
        const original_refresh = grid.refresh;
        grid.refresh = function () {
            original_refresh.apply(this, arguments);
            bind_date_and_time_events(frm);
        };
        grid.refresh_patched = true;
    }

    // Initial bind
    bind_date_and_time_events(frm);
}

function bind_date_and_time_events(frm) {
    const grid = frm.fields_dict.table_line_in_item.grid;

    $(grid.wrapper).off('change', 'input[data-fieldname="date_and_time"]');
    $(grid.wrapper).on('change', 'input[data-fieldname="date_and_time"]', function () {
        const $input = $(this);
        const grid_row = $input.closest('.grid-row');
        const row_index = grid_row.index();

        if (row_index !== 0) return;

        const raw_value = $input.val();
        if (!raw_value) return;

        let dt;
        try {
            dt = frappe.datetime.user_to_obj(raw_value);
        } catch (e) {
            frappe.msgprint("Invalid date/time format");
            return;
        }

        // ✅ Force correct format
        const db_format = [
            dt.getFullYear(),
            String(dt.getMonth() + 1).padStart(2, '0'),
            String(dt.getDate()).padStart(2, '0')
        ].join('-') + ' ' + [
            String(dt.getHours()).padStart(2, '0'),
            String(dt.getMinutes()).padStart(2, '0'),
            String(dt.getSeconds()).padStart(2, '0')
        ].join(':');

        console.log("✅ Final time to save:", db_format);

        (frm.doc.table_line_in_item || []).forEach((row, idx) => {
            if (idx === 0) return;
            frappe.model.set_value(row.doctype, row.name, 'date_and_time', db_format);
        });

        //frappe.show_alert("⏰ Time synced", 3);
    });
}