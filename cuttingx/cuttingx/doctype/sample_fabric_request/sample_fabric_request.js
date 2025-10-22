// Copyright (c) 2025, Cognitonx Logic India Private limited and contributors
// For license information, please see license.txt

frappe.ui.form.on('Sample Fabric Request', {
    // Set requested_by to current user on new document
    onload: function(frm) {
        if (frm.is_new()) {
            frm.set_value('requested_by', frappe.session.user);
        }
    },
    
    ocn: function(frm) {
        frm.set_value('item_code', '');

        if (frm.doc.ocn) {
            frm.call({
                method: 'cuttingx.cuttingx.doctype.sample_fabric_request.sample_fabric_request.get_items_from_sales_order',
                args: {
                    sales_order: frm.doc.ocn
                },
                callback: function(r) {
                    let items = r.message || [];
                    
                    if (items.length === 0) {
                        frm.set_query('item_code', {});
                        frappe.msgprint(__('No items found in Sales Order {0}.', [frm.doc.ocn]));
                        return;
                    }

                    // Set filter to only allow these items
                    frm.set_query('item_code', () => {
                        return {
                            filters: {
                                name: ['in', items]
                            }
                        };
                    });

                    // If only one item, auto-select it
                    if (items.length === 1) {
                        frm.set_value('item_code', items[0]);
                    }
                }
            });
        } else {
            frm.set_query('item_code', {});
        }
    }
});