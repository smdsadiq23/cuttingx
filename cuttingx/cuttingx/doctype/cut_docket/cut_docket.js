// Copyright (c) 2025, Cognitonx Logic India Private limited and contributors
// For license information, please see license.txt

frappe.ui.form.on('Cut Docket', {
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
    // size: function(frm, cdt, cdn) {
    //     recalculate_fabric_requirement(frm);
    // },
    planned_cut_quantity: function(frm, cdt, cdn) {
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
