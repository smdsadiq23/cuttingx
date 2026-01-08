// Copyright (c) 2025, Cognitonx Logic India Private limited
// For license information, please see license.txt

frappe.ui.form.on('Cutting Lay Record', {
    onload: function(frm) {
        // Cut Kanban No: only submitted
        frm.set_query('cut_kanban_no', function() {
            return { filters: { 'docstatus': 1 } };
        });

        // OCN (Sales Order): only submitted (keep only if ocn is Link to Sales Order)
        frm.set_query('ocn', function() {
            return { filters: { 'docstatus': 1 } };
        });

        // Work Order: filter by selected OCN + docstatus=1
        frm.set_query('work_order', function() {
            return {
                filters: frm.doc.ocn
                    ? { 'sales_order': frm.doc.ocn, 'docstatus': 1 }
                    : { name: '0' }
            };
        });

        // Can Cut: filter by selected Cut Kanban + status='Approved'
        frm.set_query('can_cut_no', function() {
            return {
                filters: frm.doc.cut_kanban_no
                    ? { 'cutting_kanban': frm.doc.cut_kanban_no, 'status': 'Approved' }
                    : { name: '0' }
            };
        });

        // grid may not be rendered on onload; add on refresh too
        setTimeout(() => add_recalculate_button(frm), 0);
    },

    refresh: function(frm) {
        applyApprovalUI(frm);
        update_chindi_weight(frm);

        // refresh is safest place to add it
        setTimeout(() => add_recalculate_button(frm), 0);
    },

    // before_submit: function(frm) {
    //     const needs = needsManagerApproval(frm);
    //     if (!needs) return;

    //     const is_manager = frappe.user_roles.includes("Can Cut Manager");

    //     if (!frm.doc.requester_remarks) {
    //         frappe.msgprint({
    //             title: __("Requester Remarks Required"),
    //             message: __("Please enter Requester Remarks before submitting for approval."),
    //             indicator: "red"
    //         });
    //         return false;
    //     }

    //     if (!is_manager) {
    //         frappe.msgprint({
    //             title: __("Approval Required"),
    //             message: __("Actual Total Piece is less than 98% of Total Piece. Only Can Cut Manager can submit."),
    //             indicator: "red"
    //         });
    //         return false;
    //     }

    //     if (!frm.doc.approver_remarks) {
    //         frappe.msgprint({
    //             title: __("Approver Remarks Required"),
    //             message: __("Please enter Approver Remarks before submitting."),
    //             indicator: "red"
    //         });
    //         return false;
    //     }
    // },

    cut_kanban_no: function(frm) {
        // Clear all dependent data
        frm.clear_table('table_lay_size_ratio');
        frm.clear_table('table_lay_roll_details');
        frm.refresh_field('table_lay_size_ratio');
        frm.refresh_field('table_lay_roll_details');

        [
            'cut_no',
            'total_ratio_qty',
            'total_roll_weight',
            'total_no_of_lays',
            'average_consumption',
            'actual_total_no_of_lays',
            'total_piece',
            'actual_total_piece',
            'end_bit_quantity',
            'chindi_weight',
            'can_cut_accuracy'
        ].forEach(field => frm.set_value(field, ''));

        // clear can_cut_no when cut_kanban_no changes
        frm.set_value('can_cut_no', '');

        applyApprovalUI(frm);
        update_chindi_weight(frm);

        if (!frm.doc.cut_kanban_no) {
            // Clear linked fields if kanban is cleared
            ['ocn', 'style', 'colour'].forEach(field => frm.set_value(field, ''));
            return;
        }

        // Auto-select can_cut_no if only one match exists (status='Approved')
        frappe.db.get_list('Can Cut', {
            filters: { 'cutting_kanban': frm.doc.cut_kanban_no, 'status': 'Approved' },
            fields: ['name'],
            limit: 2
        }).then(records => {
            console.log('Filtered Can Cut records:', records); // 👈 Add this line
            if (records.length === 1) {
                frm.set_value('can_cut_no', records[0].name);
                // marker_efficiency will auto-fetch; still calculate chindi after fetch applies
                setTimeout(() => update_chindi_weight(frm), 0);
            }
        });

        // Fetch ocn (from child), style & colour (from parent) in one call
        frappe.call({
            method: 'cuttingx.cuttingx.doctype.cutting_lay_record.cutting_lay_record.get_cut_docket_details',
            args: { cut_kanban_no: frm.doc.cut_kanban_no },
            callback: function(r) {
                if (r.message) {
                    const { ocn, style, colour } = r.message;
                    frm.set_value('ocn', ocn || '');
                    frm.set_value('style', style || '');
                    frm.set_value('colour', colour || '');
                    frm.trigger('colour');
                } else {
                    ['ocn', 'style', 'colour'].forEach(field => frm.set_value(field, ''));
                    frappe.msgprint(__('Cut Docket not found or missing required data.'));
                }
            }
        });
    },

    // when can_cut_no changes, marker_efficiency fetch changes => recalc chindi
    can_cut_no: function(frm) {
        // Wait one tick so fetch_from values are populated
        setTimeout(() => update_chindi_weight(frm), 0);
    },

    // if user edits marker_efficiency manually (if allowed), recalc
    marker_efficiency: function(frm) {
        update_chindi_weight(frm);
    },

    ocn: function(frm) {
        if (frm.doc.ocn) {
            frappe.db.get_list('Work Order', {
                filters: {
                    'sales_order': frm.doc.ocn,
                    'docstatus': 1
                },
                fields: ['name'],
                limit: 2
            }).then(records => {
                if (records.length === 1) {
                    frm.set_value('work_order', records[0].name);
                }
            });
        }
    },

    colour: function(frm) {
        // Clear dependent tables and computed fields
        frm.clear_table('table_lay_size_ratio');
        frm.clear_table('table_lay_roll_details');
        frm.refresh_field('table_lay_size_ratio');
        frm.refresh_field('table_lay_roll_details');

        [
            'cut_no',
            'total_ratio_qty',
            'total_roll_weight',
            'total_no_of_lays',
            'average_consumption',
            'actual_total_no_of_lays',
            'total_piece',
            'actual_total_piece',
            'end_bit_quantity',
            'chindi_weight'
        ].forEach(field => frm.set_value(field, ''));

        applyApprovalUI(frm);
        update_chindi_weight(frm);

        if (frm.doc.ocn && frm.doc.style && frm.doc.colour) {
            // 1. Auto-fill cut_no
            frappe.call({
                method: 'cuttingx.cuttingx.doctype.cutting_lay_record.cutting_lay_record.get_next_cut_no',
                args: {
                    cut_kanban_no: frm.doc.cut_kanban_no,
                    ocn: frm.doc.ocn,
                    style: frm.doc.style,
                    colour: frm.doc.colour
                },
                callback: function(r) {
                    if (r.message) {
                        frm.set_value('cut_no', r.message);
                    }
                }
            });

            // 2. Populate Lay Size Ratio
            frappe.call({
                method: 'cuttingx.cuttingx.doctype.cutting_lay_record.cutting_lay_record.get_sizes_for_ocn',
                args: {
                    sales_order: frm.doc.ocn,
                    style: frm.doc.style,
                    colour: frm.doc.colour
                },
                callback: function(r) {
                    const sizes = r.message || [];
                    if (sizes.length > 0) {
                        sizes.forEach(size => {
                            let row = frm.add_child('table_lay_size_ratio');
                            row.size = size;
                        });
                        frm.refresh_field('table_lay_size_ratio');
                        update_total_ratio_qty(frm);
                    }
                }
            });

            // 3. Populate Lay Roll Details
            let grn_counter = 0;
            frappe.call({
                method: 'cuttingx.cuttingx.doctype.cutting_lay_record.cutting_lay_record.get_grn_items_for_style_colour',
                args: {
                    sales_order: frm.doc.ocn,
                    style: frm.doc.style,
                    colour: frm.doc.colour
                },
                callback: function(r) {
                    const grn_items = r.message || [];
                    if (grn_items.length > 0) {
                        grn_items.forEach(grn => {
                            grn_counter++;
                            console.log("GRN Counter: " + grn_counter);
                            let row = frm.add_child('table_lay_roll_details');
                            row.grn_item_reference = grn.grn_item_reference;
                            row.roll_no = grn.roll_no;
                            row.roll_weight = grn.roll_weight;
                        });

                        recompute_all(frm);
                    }
                }
            });
        }
    },

    bit_length: function(frm) {
        recompute_all(frm);
    },

    bit_weight: function(frm) {
        recompute_all(frm);
    },

    usable_end_bit: function(frm) {
        recompute_all(frm);
    },

    splice_allowance: function(frm) {
        recompute_all(frm);
    }
});

// Child table: Lay Size Ratio
frappe.ui.form.on('Lay Size Ratio', {
    ratio: function(frm) {
        update_total_ratio_qty(frm);
    },
    table_lay_size_ratio_remove: function(frm) {
        update_total_ratio_qty(frm);
    },
    table_lay_size_ratio_add: function(frm) {
        update_total_ratio_qty(frm);
    }
});

// Child table: Lay Roll Details
frappe.ui.form.on('Lay Roll Details', {
    roll_weight: function(frm) {
        recompute_all(frm);
    },

    actual_no_of_lays: function(frm, cdt, cdn) {
        const row = locals[cdt][cdn];
        calculateActualFields(row, frm.doc.bit_weight);
        frm.refresh_field("table_lay_roll_details");
        recompute_all(frm);
    },

    // If actual_total is read-only, you can remove this handler
    actual_total: function(frm, cdt, cdn) {
        const row = locals[cdt][cdn];
        const calculated_total = parseFloat(row.calculated_total) || 0;
        const actual_total = parseFloat(row.actual_total) || 0;
        row.difference = round3(actual_total - calculated_total);
        frm.refresh_field("table_lay_roll_details");
        applyApprovalUI(frm);
    },

    // ✅ FIX: correct Frappe child-table remove/add event names
    table_lay_roll_details_remove: function(frm) {
        recompute_all(frm);
    },
    table_lay_roll_details_add: function(frm) {
        recompute_all(frm);
    }
});

// ---------------- Utility Functions ----------------

function recompute_all(frm) {
    // One place to recompute everything (handles add/remove too)
    recalculateAllLayRows(frm);

    // Safety: ensure totals + chindi + UI are consistent even if recalculateAllLayRows early-returns
    update_roll_totals(frm);
    update_actual_totals(frm);
    update_chindi_weight(frm);
    applyApprovalUI(frm);

    // IMPORTANT: recalculateAllLayRows refreshes the grid -> our injected button can disappear
    setTimeout(() => add_recalculate_button(frm), 0);
}

function round3(v) {
    return parseFloat((parseFloat(v) || 0).toFixed(3));
}

function needsManagerApproval(frm) {
    const total_piece = flt(frm.doc.total_piece);
    const actual_total_piece = flt(frm.doc.actual_total_piece);
    if (!total_piece) return false;
    return actual_total_piece < (0.98 * total_piece);
}

function applyApprovalUI(frm) {
    const needs = needsManagerApproval(frm);
    const is_manager = frappe.user_roles.includes("Can Cut Manager");
    const is_draft = cint(frm.doc.docstatus) === 0;
    const is_submitted = cint(frm.doc.docstatus) === 1;

    // defaults
    frm.set_df_property("requester_remarks", "reqd", 0);
    frm.set_df_property("requester_remarks", "read_only", 0);

    frm.set_df_property("approver_remarks", "reqd", 0);
    frm.set_df_property("approver_remarks", "hidden", 1);
    frm.set_df_property("approver_remarks", "read_only", 1);

    if (is_submitted) {
        frm.set_df_property("requester_remarks", "read_only", 1);
        frm.set_df_property("approver_remarks", "hidden", 0);
        frm.set_df_property("approver_remarks", "read_only", 1);
        frm.set_df_property("approver_remarks", "reqd", 0);
        frm.refresh_fields(["requester_remarks", "approver_remarks"]);
        return;
    }

    if (is_draft && needs) {
        frm.set_df_property("requester_remarks", "reqd", 1);

        if (is_manager) {
            frm.set_df_property("requester_remarks", "read_only", 1);

            frm.set_df_property("approver_remarks", "hidden", 0);
            frm.set_df_property("approver_remarks", "read_only", 0);
            frm.set_df_property("approver_remarks", "reqd", 1);
        } else {
            frm.set_df_property("requester_remarks", "read_only", 0);

            frm.set_df_property("approver_remarks", "hidden", 1);
            frm.set_df_property("approver_remarks", "reqd", 0);
            frm.set_df_property("approver_remarks", "read_only", 1);
        }
    } else {
        frm.set_df_property("requester_remarks", "reqd", 0);
        frm.set_df_property("requester_remarks", "read_only", 0);

        frm.set_df_property("approver_remarks", "hidden", 1);
        frm.set_df_property("approver_remarks", "reqd", 0);
        frm.set_df_property("approver_remarks", "read_only", 1);
    }

    frm.refresh_fields(["requester_remarks", "approver_remarks"]);
}

/**
 * chindi_weight = total_roll_weight - (total_roll_weight * marker_efficiency)
 * Supports 0.85 or 85 formats.
 */
function update_chindi_weight(frm) {
    const total_roll_weight = flt(frm.doc.total_roll_weight);
    let eff = frm.doc.marker_efficiency;

    eff = (eff === null || eff === undefined || eff === "") ? 0 : parseFloat(eff) || 0;
    if (eff > 1) eff = eff / 100;

    const chindi = total_roll_weight - (total_roll_weight * eff);
    frm.set_value("chindi_weight", round3(chindi));
}

function getLayBreakdown(bit_length, bit_weight, roll_weight) {
    const bw = parseFloat(bit_weight) || 0;
    const bl = parseFloat(bit_length) || 0;
    const rw = parseFloat(roll_weight) || 0;

    if (!bw || bw <= 0 || !bl || bl <= 0) {
        return { no_of_lays: 0, partial_wt: 0, partial_len: 0, calculated_total: 0 };
    }

    const total_lays = rw / bw;
    const no_of_lays = Math.floor(total_lays);
    const partial_part = total_lays - no_of_lays;

    const partial_len = round3(partial_part * bl);
    const partial_wt = round3(partial_part * bw);

    return {
        no_of_lays,
        partial_wt,
        partial_len,
        calculated_total: round3((no_of_lays * bw) + partial_wt)
    };
}

function update_total_ratio_qty(frm) {
    let total = 0;
    if (frm.doc.table_lay_size_ratio && frm.doc.table_lay_size_ratio.length) {
        frm.doc.table_lay_size_ratio.forEach(row => {
            total += flt(row.ratio);
        });
    }
    frm.set_value('total_ratio_qty', total);

    // ratio affects total_piece + approval UI, so recompute all is safest
    recompute_all(frm);
}

function update_roll_totals(frm) {
    let total_weight = 0;
    let total_lays = 0;

    if (frm.doc.table_lay_roll_details && frm.doc.table_lay_roll_details.length) {
        frm.doc.table_lay_roll_details.forEach(row => {
            total_weight += flt(row.roll_weight);
            total_lays += flt(row.no_of_lays);
        });
    }

    frm.set_value('total_roll_weight', total_weight);
    frm.set_value('total_no_of_lays', total_lays);

    update_average_consumption(frm);
    update_chindi_weight(frm);
}

function update_average_consumption(frm) {
    const total_roll_weight = flt(frm.doc.total_roll_weight);
    const total_no_of_lays = flt(frm.doc.total_no_of_lays);
    const total_ratio_qty = flt(frm.doc.total_ratio_qty);

    let avg_consumption = 0;
    if (total_no_of_lays > 0 && total_ratio_qty > 0) {
        avg_consumption = total_roll_weight / (total_no_of_lays * total_ratio_qty);
    }
    frm.set_value('average_consumption', avg_consumption);
}

function calculateActualFields(row, bit_weight) {
    const actual_no_of_lays = parseFloat(row.actual_no_of_lays) || 0;
    const bw = parseFloat(bit_weight) || 0;

    row.actual_total = round3(actual_no_of_lays * bw);

    const calculated_total = parseFloat(row.calculated_total) || 0;
    row.difference = round3(row.actual_total - calculated_total);
}

function update_actual_totals(frm) {
    const rows = frm.doc.table_lay_roll_details || [];
    let actual_total_no_of_lays = 0;

    rows.forEach(r => {
        actual_total_no_of_lays += flt(r.actual_no_of_lays);
    });

    frm.set_value('actual_total_no_of_lays', actual_total_no_of_lays);

    const total_ratio_qty = flt(frm.doc.total_ratio_qty);
    const total_no_of_lays = flt(frm.doc.total_no_of_lays);

    const total_piece = round3(total_ratio_qty * total_no_of_lays);
    const actual_total_piece = round3(total_ratio_qty * actual_total_no_of_lays);
    
    frm.set_value('total_piece', total_piece);
    frm.set_value('actual_total_piece', actual_total_piece);

    let can_cut_accuracy = 0;
    if (total_piece > 0) {
        can_cut_accuracy = (actual_total_piece / total_piece) * 100;
    }
    frm.set_value('can_cut_accuracy', parseFloat(can_cut_accuracy.toFixed(2)));    

    applyApprovalUI(frm);
}

/**
 * Virtual splice calculation (no physical roll_weight changes)
 */
function recalculateAllLayRows(frm) {
    const bit_length = parseFloat(frm.doc.bit_length) || 0;
    const bit_weight = parseFloat(frm.doc.bit_weight) || 0;

    const usable_end_bit = parseFloat(frm.doc.usable_end_bit) || 0;
    const splice_allowance = parseFloat(frm.doc.splice_allowance) || 0;

    const rows = frm.doc.table_lay_roll_details || [];

    if (!rows.length) {
        frm.refresh_field("table_lay_roll_details");
        frm.set_value('end_bit_quantity', 0);
        return;
    }

    if (!bit_length || !bit_weight) {
        rows.forEach(r => {
            r.no_of_lays = 0;
            r.partial_lay_length = 0;
            r.partial_lay_weight = 0;
            r.calculated_total = 0;
            calculateActualFields(r, bit_weight);
        });
        frm.refresh_field("table_lay_roll_details");
        frm.set_value('end_bit_quantity', 0);
        return;
    }

    const weight_per_len = bit_weight / bit_length;
    const splice_weight = splice_allowance * weight_per_len;

    // A) Baseline partials (DISPLAY)
    rows.forEach(r => {
        const base = getLayBreakdown(bit_length, bit_weight, r.roll_weight);
        r.partial_lay_length = base.partial_len;
        r.partial_lay_weight = base.partial_wt;
    });

    // B) Effective weights (VIRTUAL)
    const effectiveWeights = rows.map(r => parseFloat(r.roll_weight) || 0);

    for (let i = 0; i < rows.length - 1; i++) {
        const eff = getLayBreakdown(bit_length, bit_weight, effectiveWeights[i]);

        if (eff.partial_len < usable_end_bit) continue;

        const half_bit = 0.5 * bit_length;

        // Scenario A
        if (eff.partial_len < half_bit) {
            effectiveWeights[i] = Math.max(0, effectiveWeights[i] - eff.partial_wt);

            const transferable = Math.max(0, eff.partial_wt - splice_weight);
            effectiveWeights[i + 1] = Math.max(0, effectiveWeights[i + 1] + transferable);
            continue;
        }

        // Scenario B
        const needed_len_from_next = (bit_length - eff.partial_len) + splice_allowance;
        const needed_wt_from_next = needed_len_from_next * weight_per_len;

        const next_eff_wt = parseFloat(effectiveWeights[i + 1]) || 0;
        if (next_eff_wt <= 0) continue;

        const taken_wt = Math.min(next_eff_wt, needed_wt_from_next);

        effectiveWeights[i] = (parseFloat(effectiveWeights[i]) || 0) + taken_wt;
        effectiveWeights[i + 1] = Math.max(0, next_eff_wt - taken_wt);
    }

    // C) Final effective fields (WRITE) + end_bit_quantity
    let end_bit_quantity = 0;

    rows.forEach((r, idx) => {
        const fin = getLayBreakdown(bit_length, bit_weight, effectiveWeights[idx]);

        r.no_of_lays = fin.no_of_lays;
        r.calculated_total = fin.calculated_total;

        calculateActualFields(r, bit_weight);

        const is_last = idx === rows.length - 1;

        if (is_last) {
            end_bit_quantity += flt(fin.partial_wt);
        } else {
            if (fin.partial_len < usable_end_bit) {
                end_bit_quantity += flt(fin.partial_wt);
            }
        }
    });

    frm.set_value('end_bit_quantity', round3(end_bit_quantity));
    frm.refresh_field("table_lay_roll_details");
}

function add_recalculate_button(frm) {
    const fieldname = "table_lay_roll_details";
    const grid = frm.fields_dict[fieldname]?.grid;

    if (!grid || !grid.wrapper) return;

    const $wrapper = $(grid.wrapper);

    // prevent duplicates
    if ($wrapper.find(".btn-recalculate-lay").length) return;

    const $btn = $(
        `<button type="button" class="btn btn-xs btn-secondary btn-recalculate-lay">
            ${__("Recalculate")}
        </button>`
    );

    $btn.on("click", function () {
        recompute_all(frm);
        frappe.show_alert({ message: __("Recalculated"), indicator: "green" });
    });

    // Insert next to Add Row if present, else append to grid buttons area
    const $addRow = $wrapper.find(".grid-add-row");
    if ($addRow.length) {
        $btn.insertAfter($addRow);
    } else {
        $wrapper.find(".grid-buttons").append($btn);
    }
}
