// Copyright (c) 2025, Cognitonx Logic India Private limited and contributors
// For license information, please see license.txt

frappe.ui.form.on('Sample Fabric Issuance', {
    onload: function(frm) {
        if (frm.is_new()) {
            frm.set_value('issued_by', frappe.session.user);
        }

        // Set dynamic filter on request_id
        frm.set_query('request_id', function() {
            return {
                filters: {
                    name: ['in', []] // placeholder; will be replaced after fetch
                }
            };
        });

        // Fetch available requests and update filter
        frappe.call({
            method: 'cuttingx.cuttingx.doctype.sample_fabric_issuance.sample_fabric_issuance.get_available_sample_requests',
            callback: function(r) {
                if (r.message) {
                    frm.set_query('request_id', function() {
                        return {
                            filters: {
                                name: ['in', r.message]
                            }
                        };
                    });
                }
            }
        });
        
    },

    // Reapply GRN filter when ocn or colour changes (e.g., after request_id selection)
    ocn: function(frm) {
        frm.trigger('apply_grn_filter');
    },
    colour: function(frm) {
        frm.trigger('apply_grn_filter');
    },

    apply_grn_filter: function(frm) {
        if (frm.doc.ocn && frm.doc.colour) {
            frappe.call({
                method: 'cuttingx.cuttingx.doctype.sample_fabric_issuance.sample_fabric_issuance.get_grns_for_ocn_and_colour',
                args: {
                    ocn: frm.doc.ocn,
                    colour: frm.doc.colour
                },
                callback: function(r) {
                    const valid_grns = r.message || [];
                    frm.set_query('grn', () => ({
                        filters: {
                            name: ['in', valid_grns]
                        }
                    }));

                    // ✅ Auto-select if only one GRN
                    if (valid_grns.length === 1) {
                        // Use `true` to avoid dirty flag
                        frm.set_value('grn', valid_grns[0], true);
                    } else if (valid_grns.length === 0) {
                        // Clear if none
                        frm.set_value('grn', '', true);
                    }                    
                }
            });
        } else {
            frm.set_query('grn', {}); // no filter
        }
    },

    grn: function(frm) {
        // Populate roll options when GRN is selected
        if (frm.doc.grn && frm.doc.colour) {
            frappe.call({
                method: 'cuttingx.cuttingx.doctype.sample_fabric_issuance.sample_fabric_issuance.get_rolls_for_grn_and_colour',
                args: {
                    grn: frm.doc.grn,
                    colour: frm.doc.colour
                },
                callback: function(r) {
                    const rolls = r.message || [];
                    if (rolls.length > 0) {
                        frm.set_df_property('roll', 'options', rolls.join('\n'));
                        frm.refresh_field('roll');
                        if (rolls.length === 1) {
                            frm.set_value('roll', rolls[0]);
                        }
                    } else {
                        frm.set_df_property('roll', 'options', '');
                        frm.refresh_field('roll');
                        frappe.msgprint(__('No rolls found for selected GRN and Colour.'));
                    }
                }
            });
        } else {
            frm.set_df_property('roll', 'options', '');
            frm.refresh_field('roll');
        }
    },
});