// Copyright (c) 2025, Cognitonx Logic India Private Limited and contributors
// For license information, please see license.txt

// Global guard to prevent duplicate execution
window.can_cut_script = window.can_cut_script || {
    executed_for: new Set()
};

frappe.ui.form.on('Can Cut', {
    onload: function(frm) {
        console.log('📥 Can Cut onload triggered for', frm.doc.name);
    },

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

        // 2. Can Cut Qty = Fabric Issued / (Actual Consumption)
        let can_cut_quantity = 0;
        if (flt(d.actual_consumption) > 0) {
            can_cut_quantity = Math.floor(flt(d.fabric_issued) / flt(d.actual_consumption));
        }
        frm.set_value('can_cut_quantity', can_cut_quantity);

        // 3. Can Cut % = (Can Cut Qty / Order Quantity) * 100
        let can_cut_percent = 0;
        if (flt(d.order_quantity) > 0) {
            can_cut_percent = (flt(can_cut_quantity) / flt(d.order_quantity)) * 100;
        }
        frm.set_value('can_cut_percent', can_cut_percent.toFixed(1));

        // ✅ Profit/Loss Value (using local fob field)
        const qty_diff = flt(can_cut_quantity) - flt(d.order_quantity);
        const fob = flt(d.fob);
        const profit_loss_value = qty_diff * (fob * 0.7);

        frm.set_value('profit_loss_value', profit_loss_value);

        // Refresh approval card if needed
        if (frm.fields_dict.approval_card_html && !frm.doc.__islocal) {
            setTimeout(() => {
                const html = get_approval_card_html(frm);
                frm.set_df_property('approval_card_html', 'options', html);
                frm.refresh_field('approval_card_html');
            }, 100);
        }        
    },

    refresh: function(frm) {
        if (!frm.doc || !frm.doc.name) return;

        const docKey = `Can Cut:${frm.doc.name}`;

        // Prevent duplicate execution
        if (window.can_cut_script.executed_for.has(docKey)) {
            console.log('🔄 Can Cut refresh: Already executed for', frm.doc.name);
            return;
        }

        console.log('✅ Can Cut refresh: First execution for', frm.doc.name);
        window.can_cut_script.executed_for.add(docKey);

        // Auto-set status on first save
        if (frm.doc.docstatus === 0 && !frm.doc.__islocal && !frm.doc.status) {
            console.log('Setting status to Pending for Approval');
            frm.set_value('status', 'Pending for Approval');
        }

        const is_approver = frappe.user.has_role('Can Cut Approver');
        const is_pending = frm.doc.status === 'Pending for Approval';
        //const is_submitted = frm.doc.docstatus === 1;

        // Clear buttons
        frm.remove_custom_button('Approve');
        frm.remove_custom_button('Reject');
        //frm.remove_custom_button('Submit for Approval');

        // Hide Save button if not in Draft
        if (!frm.doc.__islocal && (is_pending || frm.doc.status !== 'Draft')) {
            frm.disable_save();
        } else {
            frm.enable_save();
        }

        // Make fields read-only only after save and not in Draft
        if (!frm.doc.__islocal && frm.doc.status && frm.doc.status !== 'Draft') {
            Object.keys(frm.fields_dict).forEach(fieldname => {
                frm.set_df_property(fieldname, 'read_only', 1);
            });
            frm.disable_save();
        }

        // Add "Submit for Approval" for creators
        // if (frm.doc.docstatus === 0 && frm.doc.status === 'Draft') {
        //     frm.add_custom_button(__('Submit for Approval'), () => {
        //         frm.set_value('status', 'Pending for Approval');
        //     }, __('Actions'));
        // }

        // Handle approval section
        if (frm.doc.__islocal) {
            if (frm.fields_dict.approval_section) {
                frm.set_df_property('approval_section', 'hidden', true);
            }
            return;
        }

        // if (is_submitted) {
        //     if (frm.fields_dict.approval_section) {
        //         frm.set_df_property('approval_section', 'hidden', true);
        //     }
        //     return;
        // }

        if (is_approver && is_pending) {
            console.log('✅ Approver + Pending → Show approval section');

            // Show approval section
            if (frm.fields_dict.approval_section) {
                frm.set_df_property('approval_section', 'hidden', false);
                frm.refresh_field('approval_section');
            }

            // Hide all other sections
            hide_all_sections_except(frm, ['approval_section']);

            // Inject card
            if (frm.fields_dict.approval_card_html) {
                const html = get_approval_card_html(frm);
                frm.set_df_property('approval_card_html', 'options', html);
                frm.set_df_property('approval_card_html', 'hidden', false);
                frm.refresh_field('approval_card_html');

                // Attach event listeners after injection
                setTimeout(() => {
                    attach_approval_listeners(frm);
                }, 100);
            }
        } else {
            if (frm.fields_dict.approval_section) {
                frm.set_df_property('approval_section', 'hidden', true);
            }
        }

        if (frm.fields_dict.deviation_under && !frm.doc.__islocal) {
            // Ensure field is visible in form (even if hidden in layout, it's okay)
            // We'll sync the card selection to the actual field
            setTimeout(() => {
                const $wrapper = $(frm.fields_dict.approval_card_html.wrapper);
                const $select = $wrapper.find('.deviation-under');
                if ($select.length) {
                    $select.on('change', function() {
                        const val = $(this).val();
                        frm.set_value('deviation_under', val);
                        // Optional: frappe.show_alert("Deviation reason saved");
                    });
                }
            }, 300);
        }        
    },

    sales_order: function(frm) {
        if (!frm.doc.sales_order) {
            frm.set_value('fob', 0);
            frm.set_value('colour', '');
            frm.set_value('style', '');
            frm.trigger('recalculate');
            return;
        }

        // Clear dependent fields
        frm.set_value('colour', '');
        frm.set_value('style', '');

        // Set query for Work Order
        frm.set_query('work_order', function() {
            return {
                filters: {
                    'sales_order': frm.doc.sales_order,
                    'docstatus': 1
                }
            };
        });        

        // Fetch Sales Order to get custom_fob
        frappe.call({
            method: 'frappe.client.get_value',
            args: {
                doctype: 'Sales Order',
                fieldname: 'custom_fob',
                filters: { 'name': frm.doc.sales_order }
            },
            callback: function(r) {
                if (r.message && r.message.custom_fob) {
                    frm.set_value('fob', r.message.custom_fob); // ✅ Auto-fill FOB
                } else {
                    frm.set_value('fob', 0);
                }
            }
        });

        frappe.call({
            method: 'frappe.client.get',
            args: {
                doctype: 'Sales Order',
                name: frm.doc.sales_order,
                fields: ['items.item_code', 'items.custom_color', 'items.custom_order_qty']
            },
            callback: function(r) {
                if (r.message) {
                    const items = r.message.items || [];

                    // Sum custom_order_qty from all items
                    const total_order_qty = items.reduce((sum, item) => {
                        return sum + (flt(item.custom_order_qty) || 0);
                    }, 0);

                    // Set in Can Cut
                    //frm.set_value('order_quantity', total_order_qty);

                    // Extract unique colors
                    const colors = [...new Set(
                        items
                            .map(item => item.custom_color)
                            .filter(Boolean)
                    )].sort();

                    // Set as options in Colour field
                    frm.set_df_property('colour', 'options', colors);
                    frm.refresh_field('colour');
                }
            }
        });

        frm.trigger('recalculate');
    },

    work_order: function(frm) {
        if (!frm.doc.work_order) {
            frm.set_value('order_quantity', 0);
            frm.set_value('fabric_ordered', 0);
            frm.set_value('colour', '');
            frm.set_value('style', '');
            frm.trigger('recalculate');
            return;
        }

        // Fetch Work Order details
        frappe.call({
            method: 'frappe.client.get',
            args: {
                doctype: 'Work Order',
                name: frm.doc.work_order,
                fields: ['qty', 'production_item', 'bom_no']
            },
            callback: function(r) {
                if (r.message) {
                    const wo = r.message;
                    const qty = flt(wo.qty);
                    const item_code = wo.production_item;

                    // Set order quantity
                    frm.set_value('order_quantity', qty);

                    // Clear previous values
                    frm.set_value('colour', '');
                    frm.set_value('style', '');

                    if (item_code) {
                        // Fetch Item details: custom_colour_name and custom_style_master
                        frappe.call({
                            method: 'frappe.client.get_value',
                            args: {
                                doctype: 'Item',
                                filters: { 'name': item_code },
                                fieldname: ['custom_colour_name', 'custom_style_master']
                            },
                            callback: function(res) {
                                if (res.message) {
                                    const item = res.message;
                                    if (item.custom_colour_name) {
                                        frm.set_value('colour', item.custom_colour_name);
                                    }
                                    if (item.custom_style_master) {
                                        frm.set_value('style', item.custom_style_master);
                                    }
                                }

                                // ✅ Fetch all auto-fill data
                                frappe.call({
                                    method: 'cuttingx.cuttingx.doctype.can_cut.can_cut.get_auto_fill_data_from_work_order',
                                    args: { work_order: frm.doc.work_order },
                                    callback: function(r) {
                                        const data = r.message || {};
                                        frm.set_value('fabric_ordered', flt(data.fabric_ordered || 0));
                                        frm.set_value('file_consumption', flt(data.file_consumption || 0));
                                        frm.set_value('file_gsm', flt(data.file_gsm || 0));
                                        frm.set_value('file_fabric_width', flt(data.file_fabric_width || 0));
                                        frm.set_value('file_dia', flt(data.file_dia || 0));                                        
                                        frm.trigger('recalculate');
                                    }
                                });
                            }
                        });
                    } else {
                        // Still try to calculate fabric_ordered (unlikely, but safe)
                        frappe.call({
                            method: 'cuttingx.cuttingx.doctype.can_cut.can_cut.get_fabric_ordered_from_work_order',
                            args: { work_order: frm.doc.work_order },
                            callback: function(r) {
                                frm.set_value('fabric_ordered', flt(r.message || 0));
                                frm.trigger('recalculate');
                            }
                        });
                    }
                }
            }
        });
    }, 

    colour: function(frm) {
        if (!frm.doc.sales_order || !frm.doc.colour) {
            frm.set_value('style', '');
            return;
        }

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
                    const matched_item = items.find(item => 
                        item.custom_color === frm.doc.colour
                    );

                    if (matched_item && matched_item.item_code) {
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

// ✅ Helper: Safe float
function flt(value, precision) {
    const val = parseFloat(value);
    if (isNaN(val)) return 0.0;
    const factor = precision ? Math.pow(10, precision) : 1000;
    return Math.round((val || 0) * factor) / factor;
}

// ✅ Build approval card HTML
function get_approval_card_html(frm) {
    // Format profit/loss value
    const profitLoss = flt(frm.doc.profit_loss_value);
    const profitLossColor = profitLoss >= 0 ? '#28a745' : '#dc3545'; // green/red
    const profitLossSign = profitLoss >= 0 ? '+' : '';
    const profitLossFormatted = profitLossSign + profitLoss.toFixed(2);

    // Build deviation_under options (update list as per your DocType)
    const deviationOptions = [
        '', 
        'Fabric', 
        'Production', 
        'Merchant'
    ];

    let deviationSelectHTML = '<option value="">Select Reason</option>';
    deviationOptions.slice(1).forEach(option => {
        const selected = frm.doc.deviation_under === option ? 'selected' : '';
        deviationSelectHTML += `<option value="${option}" ${selected}>${option}</option>`;
    });

    return `
        <div class="approval-card" style="border: 1px solid #4c9658; padding: 20px; border-radius: 8px; max-width: 800px; margin: 0 auto; background: white; font-family: Arial, sans-serif;">
            <h3 style="color: #4c9658; text-align: center; margin: 0 0 15px;">Can Cut % – Approval</h3>
            <div style="font-size: 0.9em; line-height: 1.6; margin-bottom: 15px;">
                <b>Request ID:</b> ${frm.doc.name} &nbsp;&nbsp;
                <b>Status:</b> Sent for Approval<br>
                <b>Style:</b> ${frm.doc.style || '–'} &nbsp;&nbsp;
                <b>Sales Order:</b> ${frm.doc.sales_order || '–'} &nbsp;&nbsp;
                <b>Work Order:</b> ${frm.doc.work_order || '–'} &nbsp;&nbsp;
                <b>Colour:</b> ${frm.doc.colour || '–'}<br>
                <b>Requested By:</b> ${frm.doc.owner} &nbsp;&nbsp;
                <b>On:</b> ${frappe.datetime.str_to_user(frm.doc.creation)}
            </div>

            <div style="margin: 15px 0; border-top: 1px solid #4c9658; padding-top: 15px;">
                <b>SUMMARY</b><br>
                <table style="width: 100%; border-collapse: collapse; margin: 10px 0;">
                    <tr>
                        <td style="border: 1px solid #4c9658; padding: 8px; text-align: center; font-weight: bold;">Order Fabric</td>
                        <td style="border: 1px solid #4c9658; padding: 8px; text-align: center; font-weight: bold;">Issued Fabric</td>
                        <td style="border: 1px solid #4c9658; padding: 8px; text-align: center; font-weight: bold;">Order Qty</td>
                        <td style="border: 1px solid #4c9658; padding: 8px; text-align: center; font-weight: bold;">Can Cut Qty</td>
                        <td style="border: 1px solid #4c9658; padding: 8px; text-align: center; font-weight: bold;">File Fabric Width</td>
                        <td style="border: 1px solid #4c9658; padding: 8px; text-align: center; font-weight: bold;">Actual Fabric Width</td>
                        <td style="border: 1px solid #4c9658; padding: 8px; text-align: center; font-weight: bold;">File Dia</td>
                        <td style="border: 1px solid #4c9658; padding: 8px; text-align: center; font-weight: bold;">Actual Dia</td>
                        <td style="border: 1px solid #4c9658; padding: 8px; text-align: center; font-weight: bold;">File GSM</td>
                        <td style="border: 1px solid #4c9658; padding: 8px; text-align: center; font-weight: bold;">Actual GSM</td>
                    </tr>
                    <tr>
                        <td style="border: 1px solid #4c9658; padding: 8px; text-align: center;">${flt(frm.doc.fabric_ordered)} kg</td>
                        <td style="border: 1px solid #4c9658; padding: 8px; text-align: center;">${flt(frm.doc.fabric_issued)} kg</td>
                        <td style="border: 1px solid #4c9658; padding: 8px; text-align: center;">${flt(frm.doc.order_quantity)} pcs</td>
                        <td style="border: 1px solid #4c9658; padding: 8px; text-align: center;">${flt(frm.doc.can_cut_quantity)} pcs</td>
                        <td style="border: 1px solid #4c9658; padding: 8px; text-align: center;">${flt(frm.doc.file_fabric_width)} cm</td>
                        <td style="border: 1px solid #4c9658; padding: 8px; text-align: center;">${flt(frm.doc.actual_fabric_width)} cm</td>
                        <td style="border: 1px solid #4c9658; padding: 8px; text-align: center;">${flt(frm.doc.file_dia)} cm</td>
                        <td style="border: 1px solid #4c9658; padding: 8px; text-align: center;">${flt(frm.doc.actual_dia)} cm</td>                        
                        <td style="border: 1px solid #4c9658; padding: 8px; text-align: center;">${flt(frm.doc.file_gsm)}</td>
                        <td style="border: 1px solid #4c9658; padding: 8px; text-align: center;">${flt(frm.doc.actual_gsm)}</td>
                    </tr>
                </table>
            </div>

            <div style="text-align: center; margin: 15px 0; color: #4c9658; font-size: 1.1em;">
                <b>Can Cut %:</b>
                <span style="background-color: #4c9658; color: white; padding: 4px 10px; border-radius: 4px; font-size: 0.9em; margin-left: 10px;">${parseFloat(frm.doc.can_cut_percent || 0).toFixed(2)}%</span>
            </div>

            <div style="text-align: center; margin: 15px 0; color: ${profitLossColor}; font-size: 1.1em;">
                <b>Profit / Loss Value:</b>
                <span style="background-color: ${profitLossColor}; color: white; padding: 4px 10px; border-radius: 4px; font-size: 0.9em; margin-left: 10px;">
                    ${profitLossFormatted}
                </span>
            </div>

            <div style="margin: 15px 0; font-size: 0.8em; color: #666; text-align: center;">
                <i>View Marker</i>
            </div>

            <div style="margin: 15px 0; border-top: 1px solid #4c9658; padding-top: 15px;">
                <!-- ✅ Deviation Under Field -->
                <label style="display: block; margin-bottom: 8px; font-size: 0.9em;">
                    Deviation Under ${profitLoss < 0 ? '<span style="color: red;">*</span>' : ''}
                </label>
                <select class="deviation-under" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px;">
                    ${deviationSelectHTML}
                </select>

                <label style="display: block; margin: 15px 0 8px; font-size: 0.9em;">
                    Manager Remarks (required for Reject; optional for Approve)
                </label>
                <textarea class="approval-remarks" style="width: 100%; height: 80px; border: 1px solid #ddd; padding: 8px; border-radius: 4px;"></textarea>
            </div>

            <div style="margin: 15px 0; text-align: center;">
                <button type="button" class="btn-reject" style="background-color: #d9534f; color: white; border: none; padding: 8px 16px; margin: 0 10px; border-radius: 4px; cursor: pointer;">Reject</button>
                <button type="button" class="btn-approve" style="background-color: #5cb85c; color: white; border: none; padding: 8px 16px; margin: 0 10px; border-radius: 4px; cursor: pointer;">Approve</button>
            </div>
        </div>
        </br>
    `;
}

// ✅ Attach event listeners to approval card buttons
function attach_approval_listeners(frm) {
    const $wrapper = $(frm.fields_dict.approval_card_html.wrapper);
    const $card = $wrapper.find('.approval-card');

    if (!$card.length) {
        console.warn('❌ Approval card not found in DOM');
        return;
    }

    // ✅ Get current profit/loss value from the form document
    const profitLoss = flt(frm.doc.profit_loss_value);

    // ✅ Validation function
    function validateDeviation() {
        if (profitLoss < 0) {
            const deviation = $card.find('.deviation-under').val();
            if (!deviation) {
                frappe.msgprint(__('Please select a reason under "Deviation Under" before proceeding.'));
                return false;
            }
        }
        return true;
    }

    // ✅ Approve Button
    $card.find('.btn-approve').off('click').on('click', function() {
        // ✅ Enforce deviation validation
        if (!validateDeviation()) return;

        frappe.confirm(__('Approve this Can Cut?'), () => {
            frappe.call({
                method: 'cuttingx.cuttingx.doctype.can_cut.can_cut.approve',
                args: { docname: frm.doc.name },
                callback: r => {
                    if (!r.exc) {
                        location.reload();
                    }
                }
            });
        });
    });

    // ✅ Reject Button
    $card.find('.btn-reject').off('click').on('click', function() {
        const remarks = $card.find('.approval-remarks').val();
        if (!remarks) {
            frappe.msgprint(__('Please enter remarks for rejection.'));
            return;
        }

        // ✅ Enforce deviation validation
        if (!validateDeviation()) return;

        frappe.call({
            method: 'cuttingx.cuttingx.doctype.can_cut.can_cut.reject',
            args: { docname: frm.doc.name, reason: remarks },
            callback: r => {
                if (!r.exc) {
                    location.reload();
                }
            }
        });
    });
}

// ✅ Helper: Hide all sections except listed
function hide_all_sections_except(frm, visible_section_fields) {
    Object.keys(frm.fields_dict).forEach(fieldname => {
        const df = frm.fields_dict[fieldname];
        if (df && df.df && df.df.fieldtype === 'Section Break') {
            frm.set_df_property(fieldname, 'hidden', !visible_section_fields.includes(fieldname));
        }
    });
}