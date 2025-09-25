// Copyright (c) 2025, CognitionX Logic India Private Limited and contributors
// For license information, please see license.txt

frappe.ui.form.on('Cut Docket', {
    onload: function(frm) {
        setup_work_order_filter(frm);

        // ➕ Clear roll details immediately on duplication (UX polish)
        if (frm.doc.__islocal && frm.doc.table_roll_details?.length > 0) {
            frm.doc.table_roll_details = [];
            frm.refresh_field('table_roll_details');
        }

        /// Handle recalc for other tables...
        if (frm.doc.__islocal && (
            (frm.doc.table_size_ratio_qty?.length > 0) ||
            (frm.doc.work_order_details?.length > 0)
        )) {
            // Recalculate both child tables
            Promise.all([
                recalculate_balance_client_side(frm),
                recalculate_work_order_details_client_side(frm)
            ]).then(() => {
                // Now recalculate fabric requirement (depends on size table)
                recalculate_fabric_requirement(frm);
            }).catch(err => {
                console.warn("Error during duplication recalc:", err);
                // Still try to proceed
                recalculate_fabric_requirement(frm);
            });
        }   

        if (frm.fields_dict.table_roll_details) {
            const grid = frm.fields_dict.table_roll_details.grid;
            grid.roll_details_button_added = false;
        }

        // If Style is already selected, fetch BOM and set panel_type options
        if (frm.doc.style) {
            frappe.call({
                method: "frappe.client.get",
                args: {
                    doctype: "Item",
                    name: frm.doc.style
                },
                callback: function(r) {
                    const item = r.message;
                    if (!item || !item.default_bom) return;

                    frappe.call({
                        method: "frappe.client.get",
                        args: {
                            doctype: "BOM",
                            name: item.default_bom
                        },
                        callback: function(bom_r) {
                            const bom = bom_r.message;
                            if (!bom || !bom.items) return;

                            const fabric_fg_links = bom.items
                                .filter(row => row.custom_item_type === "Fabrics" && !!row.custom_fg_link)
                                .map(row => row.custom_fg_link);

                            const unique_fg_links = [...new Set(fabric_fg_links)];

                            // Always set options, even if value is already present
                            frm.set_df_property('panel_type', 'options', unique_fg_links.join('\n'));
                            frm.refresh_field('panel_type');
                        }
                    });
                }
            });
        }
    },
    
    refresh: function(frm) {
        setup_work_order_filter(frm);

        // Add "Roll Details" button inside the table_roll_details grid
        if (frm.fields_dict.table_roll_details) {
            if (!frm.custom_roll_details_button_added) {
                const grid = frm.fields_dict.table_roll_details.grid;
                if (grid) {
                    grid.add_custom_button(
                        __('Roll Details'),
                        function () {
                            // Check if doc is new (not saved)
                            if (!frm.doc.__islocal && frm.doc.name) {
                                // Already saved – proceed with allocation
                                allocateRolls(frm);
                            } else {
                                // Not saved yet – prompt to save
                                frappe.confirm(
                                    'This document must be saved before allocating fabric rolls. Do you want to save and continue?',
                                    () => {
                                        frm.save().then(() => {
                                            allocateRolls(frm);
                                        });
                                    }
                                );
                            }
                        },
                        __('Actions')
                    );

                    frm.custom_roll_details_button_added = true;
                }
            }
        }      
    },

    style: function(frm) {
        if (!frm.doc.style) return;

        setup_work_order_filter(frm);

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
                            .filter(row => row.custom_item_type === "Fabrics" && !!row.custom_fg_link)
                            .map(row => row.custom_fg_link);

                        const unique_fg_links = [...new Set(fabric_fg_links)];

                        if (unique_fg_links.length > 0) {
                            frm.set_df_property('panel_type', 'options', unique_fg_links.join('\n'));
                            frm.refresh_field('panel_type');

                            if (unique_fg_links.length === 1) {
                                frm.set_value('panel_type', unique_fg_links[0]);
                            } else {
                                frm.set_value('panel_type', '');
                                frappe.msgprint(__('Multiple Panel Type found. Please select one.'));
                            }
                        } else {
                            frm.set_df_property('panel_type', 'options', '');
                            frm.refresh_field('panel_type');
                            frappe.msgprint(__('No Panel Type found in the BOM.'));
                        }
                    }
                });
            }
        });
    },

    panel_type: function(frm) {
        recalculate_fabric_requirement(frm);

        if (!frm.doc.bom_no || !frm.doc.panel_type) return;

        frappe.call({
            method: "cuttingx.cuttingx.doctype.cut_docket.cut_docket.get_details_on_panel_type_change",
            args: {
                bom_no: frm.doc.bom_no,
                panel_type: frm.doc.panel_type
            },
            callback: function(r) {
                const data = r.message || {};
                frm.set_value('panel_code', data.panel_code || '');
                frm.set_value('garment_way', data.garment_way || '');
                frm.set_value('fabricmaterial_details', data.fabricmaterial_details || '');
                frm.set_value('raw_material_composition', data.raw_material_composition || '');
            }
        });
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

// Child table: Cut Docket Item
frappe.ui.form.on('Cut Docket Item', {
    planned_cut_quantity: function(frm, cdt, cdn) {
        const row = locals[cdt][cdn];

        const quantity = flt(row.quantity || 0);
        const already_cut = flt(row.already_cut || 0);
        const planned = flt(row.planned_cut_quantity || 0);

        row.balance = quantity - already_cut - planned;

        frm.refresh_field('table_size_ratio_qty');
        recalculate_fabric_requirement(frm);
    }
});

// Child table: Cut Docket WO Details
frappe.ui.form.on('Cut Docket WO Details', {
    work_order: function(frm, cdt, cdn) {
        const row = locals[cdt][cdn];

        if (!row.work_order) return;

        // ✅ Check for duplicates
        const existing = frm.doc.work_order_details.filter(r => {
            return r.work_order === row.work_order && r.name !== row.name;
        });

        if (existing.length > 0) {
            frappe.msgprint(__("Work Order {0} is already added.", [row.work_order]));
            frappe.model.set_value(cdt, cdn, 'work_order', '');
            return;
        }

        // 1. Fetch already cut quantity
        frappe.call({
            method: "cuttingx.cuttingx.doctype.cut_docket.cut_docket.get_already_cut_quantity",
            args: {
                work_order: row.work_order
            },
            callback: function(r) {
                const already_cut = flt(r.message || 0);
                frappe.model.set_value(cdt, cdn, 'already_cut_quantity', already_cut);

                // Fetch work_order_quantity from Work Order
                frappe.db.get_value('Work Order', row.work_order, 'qty', (value) => {
                    const wo_qty = flt(value.qty || 0);
                    const balance = wo_qty - already_cut;
                    frappe.model.set_value(cdt, cdn, 'balance_quantity', balance);
                });
            }
        });

        // 2. Auto-fetch size details
        fetch_size_details_for_work_order(frm, row.work_order);
    }
});

// ========================
// Utility Functions
// ========================

function fetch_size_details_for_work_order(frm, work_order) {
    frappe.call({
        method: 'cuttingx.cuttingx.doctype.cut_docket.cut_docket.get_cut_docket_items_from_work_orders',
        args: {
            work_orders: JSON.stringify([work_order])
        },
        callback: function(r) {
            if (!(r.message || []).length) {
                frappe.msgprint(__("No size details found for Work Order {0}", [work_order]));
                return;
            }

            // Avoid duplicates
            const existing = (frm.doc.table_size_ratio_qty || []).map(item => {
                return `${item.ref_work_order}-${item.sales_order}-${item.line_item_no}-${item.size}`;
            });

            (r.message || []).forEach(item => {
                const key = `${item.ref_work_order}-${item.sales_order}-${item.line_item_no}-${item.size}`;
                if (!existing.includes(key)) {
                    const row = frm.add_child('table_size_ratio_qty');
                    Object.assign(row, item);
                }
            });

            frm.refresh_field('table_size_ratio_qty');
            recalculate_fabric_requirement(frm);
        }
    });
}

function recalculate_work_order_details_client_side(frm) {
    const promises = [];

    (frm.doc.work_order_details || []).forEach(row => {
        if (!row.work_order) return;

        const cdt = "Cut Docket WO Details";
        const cdn = row.name; // unique name of the child row

        const promise = frappe.call({
            method: "cuttingx.cuttingx.doctype.cut_docket.cut_docket.get_already_cut_quantity",
            args: {
                work_order: row.work_order
            },
            callback: function(r) {
                const already_cut = flt(r.message || 0);
                frappe.model.set_value(cdt, cdn, 'already_cut_quantity', already_cut);

                // Fetch Work Order quantity
                frappe.db.get_value('Work Order', row.work_order, 'qty')
                    .then(wo_data => {
                        const wo_qty = flt(wo_data.message?.qty || 0);
                        frappe.model.set_value(cdt, cdn, 'work_order_quantity', wo_qty);

                        // Calculate & persist balance
                        const balance = wo_qty - already_cut;
                        frappe.model.set_value(cdt, cdn, 'balance_quantity', balance);
                    });
            }
        });

        promises.push(promise);
    });

    return Promise.all(promises).then(() => {
        frm.refresh_field('work_order_details');
    });
}

function recalculate_balance_client_side(frm) {
    const promises = [];

    (frm.doc.table_size_ratio_qty || []).forEach(row => {
        if (!row.ref_work_order || !row.sales_order || !row.line_item_no || !row.size) {
            // Reset incomplete rows
            row.balance = flt(row.quantity);
            row.already_cut = 0;
            // Optionally: row.planned_cut_quantity = 0;
            return;
        }

        const promise = frappe.call({
            method: "cuttingx.cuttingx.doctype.cut_docket.cut_docket.get_already_cut_quantity_for_row",
            args: {
                ref_work_order: row.ref_work_order,
                sales_order: row.sales_order,
                line_item_no: row.line_item_no,
                size: row.size
            },
            callback: function(r) {
                const already_cut = flt(r.message || 0);
                const planned = flt(row.planned_cut_quantity || 0);
                const quantity = flt(row.quantity || 0);
                row.balance = quantity - already_cut - planned;
                row.already_cut = already_cut;
            }
        });

        promises.push(promise);
    });

    // ✅ ALWAYS return a Promise, even if no calls were made
    return Promise.all(promises).then(() => {
        // Refresh UI after all calls finish
        frm.refresh_field('table_size_ratio_qty');
    });
}

function recalculate_fabric_requirement(frm) {
    if (!frm.doc.bom_no || !frm.doc.panel_type || !frm.doc.table_size_ratio_qty) return;

    frappe.call({
        method: "cuttingx.cuttingx.doctype.cut_docket.cut_docket.get_fabric_requirement",
        args: {
            bom_no: frm.doc.bom_no,
            panel_type: frm.doc.panel_type,
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

// ========================
// Setup Functions
// ========================

function setup_work_order_filter(frm) {
    const grid = frm.fields_dict.work_order_details?.grid;
    if (!grid) return;

    const work_order_field = grid.get_field('work_order');
    if (work_order_field) {
        work_order_field.get_query = function() {
            if (!frm.doc.style) {
                return {
                    query: "cuttingx.cuttingx.doctype.cut_docket.cut_docket.get_empty_work_order_list"
                };
            }

            return {
                query: "cuttingx.cuttingx.doctype.cut_docket.cut_docket.get_work_orders_by_item",
                filters: {
                    item_code: frm.doc.style
                }
            };
        };
    } else {
        console.warn("Work Order field not found in grid");
    }

    frm.refresh_field('work_order_details');
}

function allocateRolls(frm) {
  frappe.call({
    method: 'cuttingx.cuttingx.doctype.cut_docket.cut_docket.allocate_fabric_rolls',
    args: { docname: frm.doc.name },
    freeze: true,
    freeze_message: __('Allocating fabric rolls...'),
    callback: function (r) {
      if (r.exc) {
        frappe.msgprint(__('Failed to allocate fabric rolls. Please check logs.'));
        return;
      }

      // Prefer a server-returned payload (recommended server shape: {status, message, shortage})
      const payload = r && r.message;
      let msg = null;
      let is_warning = false;

      if (payload) {
        if (typeof payload === 'string') {
          msg = payload;
        } else if (typeof payload === 'object') {
          msg = payload.message || null;
          is_warning = payload.status === 'warning';
        }
      }

      // If server already displayed its own messages, _server_messages will be set.
      // In that case, avoid opening another (possibly blank) modal.
      if (!msg && r._server_messages) {
        frm.reload_doc();
        return;
      }

      // No message? show a small toast instead of an empty modal
      if (!msg) {
        frappe.show_alert({ message: __('Fabric rolls allocated successfully.'), indicator: 'green' });
      } else if (is_warning) {
        frappe.msgprint(msg); // show warnings in a modal
      } else {
        frappe.show_alert({ message: msg, indicator: 'green' });
      }

      frm.reload_doc();
    },
    error: function () {
      frappe.msgprint(__('Failed to allocate fabric rolls. Please check logs.'));
    }
  });
}