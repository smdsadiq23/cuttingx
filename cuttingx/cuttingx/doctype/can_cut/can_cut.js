// Copyright (c) 2025, Cognitonx Logic India Private limited and contributors
// For license information, please see license.txt

frappe.ui.form.on('Can Cut', {
    // Trigger recalc on field changes
    fabric_ordered: function(frm) {
        frm.trigger('recalculate');
    },
    fabric_issued: function(frm) {
        frm.trigger('recalculate');
    },
    actual_consumption: function(frm) {
        frm.trigger('recalculate');
    },
    order_quantity: function(frm) {
        frm.trigger('recalculate');
    },
    // Main calculation function (client-side only for UX)
    recalculate: function(frm) {
        const d = frm.doc;

        // 1. Fabric Balance = Fabric Issued - Fabric Ordered
        const fabric_balance = flt(d.fabric_issued) - flt(d.fabric_ordered);
        frm.set_value('fabric_balance', fabric_balance);

        // 2. Can Cut Qty = Fabric Issued / (Actual Consumption / 1000)
        let can_cut_quantity = 0;
        if (flt(d.actual_consumption) > 0) {
            can_cut_quantity = flt(d.fabric_issued) / (flt(d.actual_consumption) / 1000);
        }
        frm.set_value('can_cut_quantity', Math.floor(can_cut_quantity));

        // 3. Can Cut % = (Can Cut Qty / Order Quantity) * 100
        let can_cut_percent = 0;
        if (flt(d.order_quantity) > 0) {
            can_cut_percent = (flt(can_cut_quantity) / flt(d.order_quantity));
        }
        frm.set_value('can_cut_percent', can_cut_percent.toFixed(1));
    },        
    refresh: function(frm) {
        // Auto-set status
        if (frm.doc.docstatus === 0 && !frm.doc.__islocal && !frm.doc.status) {
            frm.set_value('status', 'Pending for Approval');
        }

        // Clear existing buttons
        frm.remove_custom_button('Approve');
        frm.remove_custom_button('Reject');

        const is_approver = frappe.user.has_role('Can Cut Approver');
        const is_pending = frm.doc.status === 'Pending for Approval';

        if (is_pending && is_approver) {
            frm.add_custom_button(__('Approve'), function() {
                frappe.confirm('Approve this Can Cut?', () => {
                    frappe.call({
                        method: 'cuttingx.cuttingx.doctype.can_cut.can_cut.approve',
                        args: { docname: frm.doc.name },
                        callback: function(r) {
                            if (!r.exc) frm.reload_doc();
                        }
                    });
                });
            }, __('Actions'));

            frm.add_custom_button(__('Reject'), function() {
                frappe.prompt('Reason for rejection', (data) => {
                    frappe.call({
                        method: 'cuttingx.cuttingx.doctype.can_cut.can_cut.reject',
                        args: { docname: frm.doc.name, reason: data.value },
                        callback: function(r) {
                            if (!r.exc) frm.reload_doc();
                        }
                    });
                }, __('Reason for Rejection'));
            }, __('Actions'));
        }

        // Optional: Submit for Approval
        if (frm.doc.docstatus === 0 && frm.doc.status === 'Draft') {
            frm.add_custom_button(__('Submit for Approval'), () => {
                frm.set_value('status', 'Pending for Approval');
            }, __('Actions'));
        }
    },
    sales_order: function(frm) {
        if (!frm.doc.sales_order) {
            frm.set_value('order_quantity', 0);
            frm.set_value('colour', '');
            frm.set_value('style', '');
            frm.trigger('recalculate');  // Recalculate with zero
            return;
        }

        // Clear dependent fields
        frm.set_value('colour', '');
        frm.set_value('style', '');

        frappe.call({
            method: 'frappe.client.get',
            args: {
                doctype: 'Sales Order',
                name: frm.doc.sales_order,
                // Fetch items and their custom_order_qty
                fields: ['items.item_code', 'items.custom_color', 'items.custom_order_qty']
            },
            callback: function(r) {
                if (r.message) {
                    const items = r.message.items || [];

                    // ✅ Sum custom_order_qty from all items
                    const total_order_qty = items.reduce((sum, item) => {
                        return sum + (flt(item.custom_order_qty) || 0);
                    }, 0);

                    // ✅ Set in Can Cut
                    frm.set_value('order_quantity', total_order_qty);

                    // Extract unique colors
                    const colors = [...new Set(
                        items
                            .map(item => item.custom_color)
                            .filter(Boolean)
                    )].sort();

                    // Set as options in Colour field
                    frm.set_df_property('colour', 'options', colors);
                    frm.refresh_field('colour');

                    // ✅ Trigger recalculate
                    frm.trigger('recalculate');
                }
            }
        });

        // Set query for Work Order
        frm.set_query('work_order', function() {
            return {
                filters: {
                    'sales_order': frm.doc.sales_order,
                    'docstatus': 1
                }
            };
        });
    },
    colour: function(frm) {
        if (!frm.doc.sales_order || !frm.doc.colour) {
            frm.set_value('style', '');
            return;
        }

        // Fetch Sales Order Items again
        frappe.call({
            method: 'frappe.client.get',
            args: {
                doctype: 'Sales Order',
                name: frm.doc.sales_order,
                fields: ['items.item_code', 'items.custom_color']
            },
            callback: function(r) {
                if (r.message) {
                    const items = r.message.items || [];
                    
                    // Find the item_code that matches the selected colour
                    const matched_item = items.find(item => 
                        item.custom_color === frm.doc.colour
                    );

                    if (matched_item && matched_item.item_code) {
                        // Fetch Item to get custom_style_master
                        frappe.call({
                            method: 'frappe.client.get_value',
                            args: {
                                doctype: 'Item',
                                filters: { 'name': matched_item.item_code },
                                fieldname: 'custom_style_master'
                            },
                            callback: function(res) {
                                if (res.message && res.message.custom_style_master) {
                                    frm.set_value('style', res.message.custom_style_master);
                                } else {
                                    frm.set_value('style', '');
                                    frappe.msgprint(__(
                                        'No Style Master found for Item {0}',
                                        [matched_item.item_code]
                                    ));
                                }
                            }
                        });
                    } else {
                        frm.set_value('style', '');
                        frappe.msgprint(__('No item found for colour {0}', [frm.doc.colour]));
                    }
                }
            }
        });
    }
});