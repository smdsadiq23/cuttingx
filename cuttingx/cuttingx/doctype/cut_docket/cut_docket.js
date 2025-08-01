// Copyright (c) 2025, Cognitonx Logic India Private limited and contributors
// For license information, please see license.txt

frappe.ui.form.on('Cut Docket', {  
   onload: function(frm) {
        // Set query for Sales Order in child table based on Style
        frm.fields_dict.sale_order_details.grid.get_field('sales_order').get_query = function(doc, cdt, cdn) {
            const d = locals[cdt][cdn];

            if (!doc.style) {
                frappe.msgprint(__('Please select a Style before selecting a Sales Order.'));
                return {};
            }

            return {
                query: "cuttingx.cuttingx.doctype.cut_docket.cut_docket.get_sales_orders_by_item",
                filters: {
                    style: doc.style
                }
            };
        };

        frm.fields_dict.work_order_details.grid.get_field('work_order').get_query = function(doc, cdt, cdn) {
            const row = locals[cdt][cdn];

            // Find the corresponding SO + Line Item row from so_details
            // Assuming the first row, or match by some shared field/index
            const so_row = (doc.sale_order_details || []).find(so =>
                so.sales_order && so.line_item
            );

            if (!so_row) {
                frappe.msgprint(__('Please fill Sales Order and Line Item in SO Details.'));
                return {};
            }

            return {
                query: "cuttingx.cuttingx.doctype.cut_docket.cut_docket.get_work_orders_by_so_and_lineitem",
                filters: {
                    sales_order: so_row.sales_order,
                    line_item: so_row.line_item
                }
            };
        };
    },
    refresh: function(frm) {
        // Only inject once
        if (!frm.custom_buttons_injected) {
            frm.fields_dict.table_size_ratio_qty.grid.add_custom_button(__('Fetch Docket Items'), () => {
                const work_orders = frm.doc.work_order_details.map(row => row.work_order).filter(Boolean);

                if (!work_orders.length) {
                    frappe.msgprint("No Work Orders selected in WO Details.");
                    return;
                }

                frappe.call({
                    method: 'cuttingx.cuttingx.doctype.cut_docket.cut_docket.get_cut_docket_items_from_work_orders',
                    args: {
                        work_orders: JSON.stringify(work_orders)
                    },
                    callback: function(r) {
                        frm.clear_table('table_size_ratio_qty');
                        (r.message || []).forEach(item => {
                            const row = frm.add_child('table_size_ratio_qty');
                            Object.assign(row, item);
                        });
                        frm.refresh_field('table_size_ratio_qty');
                    }
                });
            }, 'table_size_ratio_qty');

            frm.custom_buttons_injected = true;
        }
    },   
    style: function(frm) {
        if (!frm.doc.style) return;

        // Step 1: Get default_bom from Item
        frappe.call({
            method: "frappe.client.get",
            args: {
                doctype: "Item",
                name: frm.doc.style
            },
            callback: function(r) {
                const item = r.message;
                if (!item || !item.default_bom) {
                    frappe.msgprint(__('Selected Style has no default BOM.'));
                    frm.set_value('bom_no', '');
                    return;
                }

                frm.set_value('bom_no', item.default_bom);

                // Step 2: Fetch BOM to get Fabric FG Links
                frappe.call({
                    method: "frappe.client.get",
                    args: {
                        doctype: "BOM",
                        name: item.default_bom
                    },
                    callback: function(bom_r) {
                        const bom = bom_r.message;
                        if (!bom || !bom.items || bom.items.length === 0) {
                            frappe.msgprint(__("No BOM Items found."));
                            return;
                        }

                        const fabric_fg_links = bom.items
                            .filter(row =>
                                row.custom_item_type === "Fabrics" &&
                                !!row.custom_fg_link
                            )
                            .map(row => row.custom_fg_link);

                        const unique_fg_links = [...new Set(fabric_fg_links)];

                        if (unique_fg_links.length > 0) {
                            frm.set_df_property('panel_code', 'options', unique_fg_links.join('\n'));
                            frm.refresh_field('panel_code');

                            if (unique_fg_links.length === 1) {
                                frm.set_value('panel_code', unique_fg_links[0]);
                            } else {
                                frm.set_value('panel_code', '');
                                frappe.msgprint(__('Multiple Fabric FG Links found. Please select one.'));
                            }
                        } else {
                            frm.set_df_property('panel_code', 'options', '');
                            frm.refresh_field('panel_code');
                            frappe.msgprint(__('No Fabric FG Links found in the BOM.'));
                        }
                    }
                });
            }
        });
    },
    panel_code: function(frm) {
        recalculate_fabric_requirement(frm);
    },
    fabric_requirement_against_bom: function(frm) {
        calculate_marker_efficiency(frm);
    },      
    marker_length_meters: function(frm) {
        calculate_fabric_requirement_against_marker(frm);
        calculate_marker_efficiency(frm);
    },
    marker_width_meters: function(frm) {
        calculate_marker_efficiency(frm);
    },    
    no_of_plies: function(frm) {
        calculate_fabric_requirement_against_marker(frm);
        calculate_marker_efficiency(frm);
    }  
});


frappe.ui.form.on('Cut Docket Item', {
    planned_cut_quantity: function(frm, cdt, cdn) {
        const row = locals[cdt][cdn];

        const quantity = flt(row.quantity || 0);
        const already_cut = flt(row.already_cut || 0);
        const planned = flt(row.planned_cut_quantity || 0);

        row.balance = quantity - already_cut - planned;

        frm.refresh_field('cut_docket_item');
        recalculate_fabric_requirement(frm);
    }
});


function recalculate_fabric_requirement(frm) {
    if (!frm.doc.bom_no || !frm.doc.panel_code || !frm.doc.table_size_ratio_qty) return;
    frappe.call({
        method: "cuttingx.cuttingx.doctype.cut_docket.cut_docket.get_fabric_requirement",
        args: {
            bom_no: frm.doc.bom_no,
            panel_code: frm.doc.panel_code,
            size_table: JSON.stringify(frm.doc.table_size_ratio_qty)
        },
        callback: function(r) {
            frm.set_value("fabric_requirement_against_bom", r.message || 0);
        }
    });
}

function calculate_fabric_requirement_against_marker(frm) {
    const marker = flt(frm.doc.marker_length_meters);
    const plies = flt(frm.doc.no_of_plies);

    if (marker && plies) {
        frm.set_value("fabric_requirement_against_marker", marker * plies);
    } else {
        frm.set_value("fabric_requirement_against_marker", 0);
    }
}

function calculate_marker_efficiency(frm) {
    const fabric_requirement = flt(frm.doc.fabric_requirement_against_bom);
    const marker_length = flt(frm.doc.marker_length_meters);
    const marker_width = flt(frm.doc.marker_width_meters);
    const no_of_plies = flt(frm.doc.no_of_plies);

    const denominator = marker_length * marker_width * no_of_plies;

    if (denominator > 0) {
        const efficiency = (fabric_requirement / denominator) * 100;
        frm.set_value("marker_efficiency", efficiency);
    } else {
        frm.set_value("marker_efficiency", 0);
    }
}

frappe.ui.form.on('Cut Docket SO Details', {
    sales_order: function(frm, cdt, cdn) {
        const row = locals[cdt][cdn];

        if (!row.sales_order) {
            frappe.msgprint(__('Please select a Sales Order.'));
            return;
        }

        frappe.call({
            method: "frappe.client.get",
            args: {
                doctype: "Sales Order",
                name: row.sales_order
            },
            callback: function(r) {
                const so = r.message;
                if (!so || !so.items || so.items.length === 0) {
                    frappe.msgprint(__('No Items found in selected Sales Order.'));
                    return;
                }

                // Extract custom_lineitem values from Sales Order Items
                const line_items = so.items
                    .map(item => item.custom_lineitem)
                    .filter(v => !!v); // remove falsy/null/undefined

                const unique_line_items = [...new Set(line_items)];

                // Set the options for the `line_item` select field
                frm.fields_dict.sale_order_details.grid.update_docfield_property(
                    'line_item',
                    'options',
                    unique_line_items.join('\n')
                );

                // Clear existing value
                frappe.model.set_value(cdt, cdn, 'line_item', '');

                // Auto-select if only one option
                if (unique_line_items.length === 1) {
                    frappe.model.set_value(cdt, cdn, 'line_item', unique_line_items[0]);
                }

                frm.fields_dict.sale_order_details.grid.refresh();
            }
        });
    }
});

frappe.ui.form.on('Cut Docket WO Details', {
    work_order: function(frm, cdt, cdn) {
        const row = locals[cdt][cdn];

        if (!row.work_order) return;

        frappe.call({
            method: "cuttingx.cuttingx.doctype.cut_docket.cut_docket.get_already_cut_quantity",
            args: {
                work_order: row.work_order
            },
            callback: function(r) {
                const already_cut = flt(r.message || 0);
                frappe.model.set_value(cdt, cdn, 'already_cut_quantity', already_cut);

                // Fetch work_order_quantity from Work Order doctype
                frappe.db.get_value('Work Order', row.work_order, 'qty', (value) => {
                    const wo_qty = flt(value.qty || 0);
                    const balance = wo_qty - already_cut;
                    frappe.model.set_value(cdt, cdn, 'balance_quantity', balance);
                });
            }
        });
    }
});
