// Copyright (c) 2025, Cognitonx Logic India Private Limited and contributors
// For license information, please see license.txt

frappe.ui.form.on('Bundle Creation', {
    onload: function(frm) {
        // Set filter for cut_docket_id
        frm.set_query('cut_docket_id', () => {
            return {
                filters: [
                    ['name', 'in', get_eligible_cut_dockets()]
                ]
            };
        });

        // Try to inject button on load
        inject_fetch_button(frm);
    },

    refresh: function(frm) {
        // Protect child tables
        protect_child_table(frm);

        // Inject fetch button
        inject_fetch_button(frm);

        // Add "Create Bundles" button
        if (!frm.custom_bundle_button_added) {
            const grid = frm.fields_dict.table_bundle_details?.grid;
            if (grid) {
                grid.add_custom_button(__('Create Bundles'), function () {
                    if (!frm.doc.__islocal && frm.doc.name) {
                        // Already saved – proceed
                        generate_bundles(frm);
                    } else {
                        // Save first
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
        }
    },

    // On cut_docket_id change – only trigger UI update
    cut_docket_id: function(frm) {
        frappe.after_ajax(() => {
            setTimeout(() => protect_child_table(frm), 100);
        });
    },

    // Validate on save
    validate: function(frm) {
        const no_of_plies = frm.doc.no_of_plies || 0;
        const table = frm.doc.table_shade_and_ply || [];
        const total = table.reduce((sum, row) => sum + (row.ply_count || 0), 0);

        if (total > no_of_plies) {
            frappe.throw(__(
                'Cannot save: Total Ply Count ({0}) exceeds No of Plies ({1}).',
                [total, no_of_plies]
            ));
        }
    }
});

// ✅ Inject "Fetch from Cut Docket" button into Bundle Creation Item grid
function inject_fetch_button(frm) {
    const fieldname = 'table_bundle_creation_item';
    const grid = frm.fields_dict[fieldname]?.grid;

    if (!grid) return;

    // Avoid duplicate injection
    if (grid.fetch_button_patched) return;

    // Patch grid's refresh method
    const original_refresh = grid.refresh;
    grid.refresh = function () {
        original_refresh.apply(this, arguments);

        // Re-inject button after refresh
        setTimeout(() => {
            if (!this.fetch_button_added) {
                this.add_custom_button(
                    __('Fetch from Cut Docket'),
                    () => fetch_and_split_data(frm),
                    __('Actions')
                );
                this.fetch_button_added = true;
            }
        }, 100);
    };

    grid.fetch_button_patched = true;
    grid.refresh(); // Trigger injection
}

// ✅ Handle ply count changes in Shade and Ply table
frappe.ui.form.on('Bundle Shade and Ply', {
    ply_count: function(frm, cdt, cdn) {
        const row = locals[cdt][cdn];
        const no_of_plies = frm.doc.no_of_plies || 0;

        // Calculate shade %        
        if (row.ply_count && no_of_plies > 0) {
            const percent = (row.ply_count / no_of_plies) * 100;
            frappe.model.set_value(cdt, cdn, 'shade_percent', `${percent.toFixed(1)}%`);
        } else {
            frappe.model.set_value(cdt, cdn, 'shade_percent', '');
        }

        // Recalculate all ply numbers
        const table = frm.doc.table_shade_and_ply;
        if (table && Array.isArray(table)) {
            table.forEach(r => calculate_ply_numbers(frm, r.doctype, r.name));
            frm.refresh_field('table_shade_and_ply');
        }

        // Validate and correct if total exceeds
        validate_and_correct_ply_count(frm, cdt, cdn);
    },

    table_shade_and_ply_remove: function(frm) {
        const table = frm.doc.table_shade_and_ply;
        if (table && Array.isArray(table)) {
            table.forEach(r => calculate_ply_numbers(frm, r.doctype, r.name));
            frm.refresh_field('table_shade_and_ply');
        }
        validate_and_correct_ply_count(frm);
    }
});

function fetch_and_split_data(frm) {
    if (!frm.doc.cut_docket_id) {
        frappe.msgprint(__('Please select a Cut Docket first.'));
        return;
    }

    // Step 1: Fetch data from Cut Docket
    frappe.call({
        method: 'cuttingx.cuttingx.doctype.bundle_creation.bundle_creation.get_cut_confirmation_items_from_docket',
        args: { cut_docket_id: frm.doc.cut_docket_id },
        callback: function(r) {
            if (!(r.message || []).length) {
                frappe.msgprint(__('No data found in Cut Confirmation for this Cut Docket.'));
                return;
            }

            // Step 2: Get shade distribution with ply details
            const shade_table = frm.doc.table_shade_and_ply;
            if (!shade_table || !shade_table.length) {
                frappe.msgprint(__('Please define Shade and Ply details first.'));
                return;
            }

            // Map shade_code → ply range
            const shade_map = {};
            shade_table.forEach(row => {
                shade_map[row.shade_code] = {
                    start: row.start_ply_no || 1,
                    end: row.end_ply_no || 1,
                };
            });

            const no_of_plies = frm.doc.no_of_plies || 1;

            // Step 3: Clear and rebuild table
            frm.clear_table('table_bundle_creation_item');

            (r.message || []).forEach(original_row => {
                const size = original_row.size;
                const total_cut_qty = original_row.cut_quantity;
                let allocated = 0;
                const rows = [];

                // First pass: calculate all but last
                Object.keys(shade_map).forEach((shade_code, idx) => {
                    const shade = { shade_code };
                    const new_qty = Math.round((total_cut_qty * (idx === 0 ? 100 : 0)) / 100); // Placeholder

                    // Get actual percentage from shade_map source? No — use `shade_percent` if available
                    // But we already have `shade_map` from `table_shade_and_ply`, so use it
                    // We'll assume all shades are in `shade_table` and we use their order
                });

                // ✅ Use actual shade_table to preserve order
                shade_table.forEach((shade_row, idx) => {
                    const shade_code = shade_row.shade_code;
                    const pct = parseFloat((shade_row.shade_percent || '').replace('%', '')) || 0;
                    const new_qty = Math.round((total_cut_qty * pct) / 100);
                    if (new_qty <= 0 && idx !== shade_table.length - 1) return;

                    allocated += new_qty;

                    const row = {
                        work_order: original_row.work_order,
                        sales_order: original_row.sales_order,
                        line_item_no: original_row.line_item_no,
                        size: size,
                        cut_quantity: total_cut_qty,
                        shade: shade_code,
                        //unitsbundle: original_row.unitsbundle || 1,
                        shade_cut_quantity: new_qty
                    };

                    rows.push(row);
                });

                // ✅ Adjust last row
                if (rows.length > 0) {
                    const last_row = rows[rows.length - 1];
                    const adjustment = total_cut_qty - allocated;
                    last_row.shade_cut_quantity += adjustment;

                    if (last_row.shade_cut_quantity < 0) {
                        frappe.msgprint(__(
                            'Shade Cut Quantity for Size {0} is negative. Check shade percentages.',
                            [size]
                        ));
                        last_row.shade_cut_quantity = 0;
                    }
                }

                // ✅ Append rows with ply info
                rows.forEach(row => {
                    const shade_row = shade_table.find(s => s.shade_code === row.shade);
                    const start = shade_row?.start_ply_no || 1;
                    const end = shade_row?.end_ply_no || 1;

                    const child = frm.add_child('table_bundle_creation_item');
                    Object.assign(child, row, {
                        ply: `${start}-${end} of ${no_of_plies}`
                    });

                    //calculate_bundles(frm, child.doctype, child.name);
                });
            });

            frm.refresh_field('table_bundle_creation_item');
            frappe.show_alert({
                message: __('✅ Fetched and split {0} rows by shade with ply info.', [r.message.length]),
                indicator: 'green'
            }, 5);
        }
    });
}

// ✅ Handle Bundle Creation Item changes
frappe.ui.form.on('Bundle Shade and Ply', {
    ply_count: function(frm, cdt, cdn) {
        const row = locals[cdt][cdn];
        const no_of_plies = frm.doc.no_of_plies || 0;

        // Calculate shade %
        if (row.ply_count && no_of_plies > 0) {
            const percent = (row.ply_count / no_of_plies) * 100;
            frappe.model.set_value(cdt, cdn, 'shade_percent', `${percent.toFixed(1)}%`);
        } else {
            frappe.model.set_value(cdt, cdn, 'shade_percent', '');
        }

        // Recalculate all ply numbers
        const table = frm.doc.table_shade_and_ply;
        if (table && Array.isArray(table)) {
            table.forEach(r => calculate_ply_numbers(frm, r.doctype, r.name));
            frm.refresh_field('table_shade_and_ply');
        }

        // Validate and correct if total exceeds
        validate_and_correct_ply_count(frm, cdt, cdn);
    },

    table_shade_and_ply_remove: function(frm) {
        const table = frm.doc.table_shade_and_ply;
        if (table && Array.isArray(table)) {
            table.forEach(r => calculate_ply_numbers(frm, r.doctype, r.name));
            frm.refresh_field('table_shade_and_ply');
        }
        validate_and_correct_ply_count(frm);
    }
});

function calculate_ply_numbers(frm, cdt, cdn) {
    const row = locals[cdt][cdn];
    const table = frm.doc.table_shade_and_ply;
    if (!table || !Array.isArray(table)) return;

    const sorted = [...table].sort((a, b) => a.idx - b.idx);
    let cumulative = 0;

    for (const r of sorted) {
        if (r.idx === row.idx) break;
        if (r.ply_count) cumulative += r.ply_count;
    }

    const start_ply = cumulative + 1;
    const end_ply = start_ply + (row.ply_count || 0) - 1;

    frappe.model.set_value(cdt, cdn, 'start_ply_no', start_ply);
    frappe.model.set_value(cdt, cdn, 'end_ply_no', end_ply);
}

function validate_and_correct_ply_count(frm, cdt, cdn) {
    const no_of_plies = frm.doc.no_of_plies || 0;
    const table = frm.doc.table_shade_and_ply || [];
    const total = table.reduce((sum, row) => sum + (row.ply_count || 0), 0);

    if (total > no_of_plies && cdt && cdn) {
        frappe.model.set_value(cdt, cdn, 'ply_count', 0);
        frappe.model.set_value(cdt, cdn, 'shade_percent', '');

        frappe.msgprint({
            title: __('Ply Count Exceeded'),
            message: __(
                'Total Ply Count ({0}) exceeds No of Plies ({1}).<br>Ply Count for this row has been reset.',
                [total, no_of_plies]
            ),
            indicator: 'orange'
        });

        frm.doc.table_shade_and_ply.forEach(r => calculate_ply_numbers(frm, r.doctype, r.name));
        frm.refresh_field('table_shade_and_ply');
        return false;
    }
    return true;
}

// ✅ Calculate no_of_bundles from cut_quantity and unitsbundle
function calculate_bundles(frm, cdt, cdn) {
    const row = locals[cdt][cdn];
    const qty = row.cut_quantity || 0;
    const units = row.unitsbundle || 1;
    const no_of_bundles = Math.ceil(qty / units);
    frappe.model.set_value(cdt, cdn, 'no_of_bundles', no_of_bundles);
}

// ✅ Generate bundles
function generate_bundles(frm) {
    frappe.call({
        method: 'cuttingx.cuttingx.doctype.bundle_creation.bundle_creation.generate_bundle_details',
        args: { docname: frm.doc.name },
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

// ✅ Hide "Add Row" and "Delete Rows" buttons in child tables
function protect_child_table(frm) {
    const fieldnames = ['table_bundle_creation_item', 'table_bundle_details'];

    fieldnames.forEach(fieldname => {
        const grid = frm.fields_dict[fieldname]?.grid;
        if (!grid) return;

        // ✅ Hide "Add Row" and "Delete Rows" buttons
        setTimeout(() => {
            if (grid.grid_buttons) {
                grid.grid_buttons.find('.grid-add-row').hide();
                grid.grid_buttons.find('.grid-remove-rows').hide();
            }
        }, 100);

        // ✅ Patch create_new_row to block manual addition
        if (!grid.create_new_row_patched) {
            const original_create_new_row = grid.create_new_row;
            grid.create_new_row = function () {
                console.log('🛑 Blocked: Manual row creation prevented');
                // Do nothing
            };
            grid.create_new_row_patched = true;
        }

        // ✅ Re-hide after refresh
        if (!grid.refresh_patched) {
            const original_refresh = grid.refresh;
            grid.refresh = function () {
                original_refresh.apply(this, arguments);
                setTimeout(() => {
                    if (this.grid_buttons) {
                        this.grid_buttons.find('.grid-add-row').hide();
                        this.grid_buttons.find('.grid-remove-rows').hide();
                    }
                }, 50);
            };
            grid.refresh_patched = true;
        }
    });
}

function hide_add_row_button(grid) {
    if (grid.refresh_patched) return;

    const original_refresh = grid.refresh;
    grid.refresh = function () {
        original_refresh.apply(this, arguments);
        setTimeout(() => {
            const $btn = this.grid_buttons?.find('.grid-add-row');
            if ($btn) {
                $btn.hide();
                $btn.data('permanently-hidden', true);
            }
        }, 50);
    };
    grid.refresh_patched = true;
}