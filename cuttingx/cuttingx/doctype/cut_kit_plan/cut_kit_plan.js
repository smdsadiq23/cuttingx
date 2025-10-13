// Copyright (c) 2025, Cognitonx Logic India Private Limited and contributors
// For license information, please see license.txt

frappe.ui.form.on('Cut Kit Plan', {
    fg_item: function(frm) {
        if (!frm.doc.fg_item) {
            frm.set_value("sales_order", "");
            frm.set_value("work_order", "");
            frm.set_value("style", "");
            frm.set_value("colour", "");
            return;
        }

        frappe.call({
            method: "cuttingx.cuttingx.doctype.cut_kit_plan.cut_kit_plan.get_auto_fill_data",
            args: { fg_item: frm.doc.fg_item },
            callback: function(r) {
                if (r.message) {
                    const { sales_order, work_order, style, colour } = r.message;
                    if (!frm.doc.sales_order) frm.set_value("sales_order", sales_order);
                    if (!frm.doc.work_order) frm.set_value("work_order", work_order);
                    if (!frm.doc.style) frm.set_value("style", style);
                    if (!frm.doc.colour) frm.set_value("colour", colour);
                    frm.refresh_fields();
                }
            }
        });
    },

    order_method: function(frm) {
        set_supplier_query(frm);
    },
    
    cut_bundle_order: function(frm) {
        if (!frm.doc.cut_bundle_order) {
            frm._full_bundle_data = null;
            frm.clear_table("included_components");
            frm.clear_table("table_ckp_bundle_details");
            frm.clear_table("table_ckp_bundle_summary");
            frm.refresh_field("included_components");
            frm.refresh_field("table_ckp_bundle_details");
            frm.refresh_field("table_ckp_bundle_summary"); 
            frm.set_value("cut_kit_qty", null);           
            return;
        }

        // SINGLE SERVER CALL: get full data + unique components
        frappe.call({
            method: "cuttingx.cuttingx.doctype.cut_kit_plan.cut_kit_plan.get_bundle_details_with_components",
            args: { bundle_creation_name: frm.doc.cut_bundle_order },
            callback: function(r) {
                if (r.message) {
                    const { bundle_details, unique_components } = r.message;
                    
                    // Store full data in memory
                    frm._full_bundle_data = bundle_details;

                    // Set dropdown options for Included Components
                    frm.set_df_property("component", "options", unique_components.join("\n"), "Included Components");
                    
                    // Auto-fill Included Components with all components
                    frm.clear_table("included_components");
                    unique_components.forEach(comp => {
                        let row = frm.add_child("included_components");
                        row.component = comp;
                    });
                    frm.refresh_field("included_components");

                    // Initially show ALL bundle details
                    apply_included_components_filter(frm);
                }
            }
        });
    },

    onload: function(frm) {
        frm.set_query("cut_bundle_order", () => ({
            query: "cuttingx.cuttingx.doctype.cut_kit_plan.cut_kit_plan.filter_available_bundles",
            filters: { "Bundle Configuration Submitted": 1, "Already Cut Kit Plan created": "No" }
        }));

        // Ensure component field always has dynamic options
        const component_field = frappe.meta.get_docfield("Cut Kit Plan Components", "component");
        if (component_field) {
            const original_get_options = component_field.get_options;
            component_field.get_options = function() {
                if (frm._full_bundle_data) {
                    const all_components = [...new Set(frm._full_bundle_data.map(row => row.component))];
                    const currently_selected = get_selected_components(frm);
                    const available = all_components.filter(c => !currently_selected.includes(c));
                    return available.join("\n");
                }
                return original_get_options ? original_get_options.call(this) : "";
            };
        }
    }    
});

// Handle Included Components changes
frappe.ui.form.on('Cut Kit Plan Components', {
    component: function(frm) {
        setTimeout(() => apply_included_components_filter(frm), 100);
    },
    included_components_remove: function(frm) {
        setTimeout(() => apply_included_components_filter(frm), 100);
    },
    included_components_add: function(frm, cdt, cdn) {
        // Get all possible components from full bundle data
        if (frm._full_bundle_data) {
            const all_components = [...new Set(frm._full_bundle_data.map(row => row.component))];
            
            // Get currently selected components (excluding the new empty row)
            const currently_selected = get_selected_components(frm);
            
            // Options = all components MINUS already selected ones
            const available_options = all_components.filter(comp => !currently_selected.includes(comp));
            const options_str = available_options.join("\n");
            
            // Set options for this specific new row
            frappe.meta.get_docfield("Cut Kit Plan Components", "component", cdn).options = options_str;
        }
        setTimeout(() => apply_included_components_filter(frm), 100);
    }
});


/* --------------------------- Helpers ---------------------------------- */

frappe.ui.form.on('Cut Kit Plan Bundle Details', {
    production_item_number: function(frm) { update_summary_table(frm); },
    shade: function(frm) { update_summary_table(frm); },
    size: function(frm) { update_summary_table(frm); },
    component: function(frm) { update_summary_table(frm); },
    bundle_qty: function(frm) { update_summary_table(frm); },
    table_ckp_bundle_details_add: function(frm) { update_summary_table(frm); },
    table_ckp_bundle_details_remove: function(frm) { update_summary_table(frm); }
});


function set_supplier_query(frm) {
    if (frm.doc.order_method) {
        frm.set_query("supplier", function() {
            return {
                query: "cuttingx.cuttingx.doctype.cut_kit_plan.cut_kit_plan.filter_suppliers_by_order_method",
                filters: { order_method: frm.doc.order_method }
            };
        });
    } else {
        frm.set_query("supplier", {});
    }
}


// Helper: Get CURRENT selected components (works during add/remove events)
function get_selected_components(frm) {
  const rows = frm.doc.included_components || [];
  return rows.filter(r => r.component).map(r => r.component);
}

// Helper: Filter and populate bundle details
function apply_included_components_filter(frm) {
    const selected_components = get_selected_components(frm);
    frm.clear_table("table_ckp_bundle_details");

    if (!frm._full_bundle_data || selected_components.length === 0) {
        frm.refresh_field("table_ckp_bundle_details");
        update_summary_table(frm);
        return;
    }

    const filtered = frm._full_bundle_data.filter(row => 
        selected_components.includes(row.component)
    );

    filtered.forEach(row => {
        let c = frm.add_child("table_ckp_bundle_details");
        c.production_item_number = row.production_item_number;
        c.shade = row.shade;
        c.size = row.size;
        c.component = row.component;
        c.bundle_qty = row.bundle_qty;
    });

    frm.refresh_field("table_ckp_bundle_details");
    update_summary_table(frm);
}
function update_summary_table(frm) {
    let total_qty = 0;
    let summary = {};

    (frm.doc.table_ckp_bundle_details || []).forEach(row => {
        if (row.bundle_qty) {
            total_qty += flt(row.bundle_qty);
        }

        if (!row.size || !row.component) return;

        let key = `${row.size}|${row.component}`;
        if (!summary[key]) {
            summary[key] = { size: row.size, component: row.component, quantity: 0 };
        }
        summary[key].quantity += flt(row.bundle_qty);
    });

    frm.clear_table("table_ckp_bundle_summary");
    Object.values(summary).forEach(item => {
        let child = frm.add_child("table_ckp_bundle_summary");
        child.size = item.size;
        child.component = item.component;
        child.quantity = item.quantity;
    });

    frm.refresh_field("table_ckp_bundle_summary");
    frm.set_value("cut_kit_qty", total_qty);    
}