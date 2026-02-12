// Copyright (c) 2025, Cognitonx Logic India Private Limited and contributors
// For license information, please see license.txt

window.can_cut_script = window.can_cut_script || {
    executed_for: new Set()
};

frappe.ui.form.on('Can Cut', {
    onload: function(frm) {
        // ✅ If no Cutting Kanban selected -> show NOTHING in Sales Order
        frm.set_query('sales_order', function() {
            return frm.doc.cutting_kanban
                ? {}
                : { filters: { name: '0' } };
        });

        // ✅ If no Sales Order selected -> show NOTHING in Work Order
        frm.set_query('work_order', function() {
            return frm.doc.sales_order
                ? { filters: frm.doc.sales_order ? { 'sales_order': frm.doc.sales_order, 'docstatus': 1 } : { name: '0' } }
                : { filters: { name: '0' } };
        });

        frm.__cutting_kanban_cache = frm.__cutting_kanban_cache || {
            loaded_for: null,
            sales_orders: [],
            work_orders_by_so: {}
        };
    },

    // ✅ NEW: Cutting Kanban selection drives Sales Order + Work Order filtering
    cutting_kanban: function(frm) {
        frm.__cutting_kanban_cache = frm.__cutting_kanban_cache || {
            loaded_for: null,
            sales_orders: [],
            work_orders_by_so: {}
        };

        // If cleared -> clear SO/WO and show nothing
        if (!frm.doc.cutting_kanban) {
            frm.__cutting_kanban_cache.loaded_for = null;
            frm.__cutting_kanban_cache.sales_orders = [];
            frm.__cutting_kanban_cache.work_orders_by_so = {};

            frm.set_value('sales_order', '');
            frm.set_value('work_order', '');

            frm.set_query('sales_order', function() {
                return { filters: { name: '0' } };
            });

            frm.set_query('work_order', function() {
                return { filters: { name: '0' } };
            });

            return;
        }

        frappe.call({
            method: 'cuttingx.cuttingx.doctype.can_cut.can_cut.get_so_wo_from_cut_docket',
            args: { cut_docket: frm.doc.cutting_kanban },
            callback: function(r) {
                if (r.exc) {
                    frappe.msgprint(__('Unable to load Sales Order / Work Order from Cutting Kanban. Please check server logs.'));
                    return;
                }

                const data = r.message || {};
                const sales_orders = data.sales_orders || [];
                const work_orders_by_so = data.work_orders_by_so || {};

                frm.__cutting_kanban_cache.loaded_for = frm.doc.cutting_kanban;
                frm.__cutting_kanban_cache.sales_orders = sales_orders;
                frm.__cutting_kanban_cache.work_orders_by_so = work_orders_by_so;

                // ✅ Sales Order filtered strictly by Cutting Kanban
                frm.set_query('sales_order', function() {
                    if (!frm.doc.cutting_kanban) return { filters: { name: '0' } };
                    if (!sales_orders.length) return { filters: { name: '0' } };
                    return {
                        filters: {
                            name: ['in', sales_orders],
                            docstatus: 1
                        }
                    };
                });

                // If current SO isn't valid, clear
                if (frm.doc.sales_order && !sales_orders.includes(frm.doc.sales_order)) {
                    frm.set_value('sales_order', '');
                    frm.set_value('work_order', '');
                    frm.set_query('work_order', function() {
                        return { filters: { name: '0' } };
                    });
                    return;
                }

                // ✅ Auto-select SO if only one
                if (!frm.doc.sales_order && sales_orders.length === 1) {
                    frm.set_value('sales_order', sales_orders[0]);
                    // Work order will be handled by sales_order handler
                } else {
                    // if SO already present -> apply WO filter
                    if (frm.doc.sales_order) {
                        apply_work_order_filter_from_cutting_kanban(frm);
                        auto_pick_single_work_order_safely(frm);
                    } else {
                        frm.set_query('work_order', function() {
                            return { filters: { name: '0' } };
                        });
                    }
                }
            }
        });
    },

    fabric_ordered: function(frm) { frm.trigger('recalculate'); },
    fabric_issued: function(frm) { frm.trigger('recalculate'); },
    actual_consumption: function(frm) { frm.trigger('recalculate'); },
    order_quantity: function(frm) { frm.trigger('recalculate'); },

    recalculate: function(frm) {
        const d = frm.doc;
        const fabric_balance = flt(d.fabric_issued) - flt(d.fabric_ordered);
        frm.set_value('fabric_balance', fabric_balance);

        let can_cut_quantity = 0;
        if (flt(d.actual_consumption) > 0) {
            can_cut_quantity = Math.floor(flt(d.fabric_issued) / flt(d.actual_consumption));
        }
        frm.set_value('can_cut_quantity', can_cut_quantity);

        let can_cut_percent = 0;
        if (flt(d.order_quantity) > 0) {
            can_cut_percent = (flt(can_cut_quantity) / flt(d.order_quantity)) * 100;
        }
        frm.set_value('can_cut_percent', can_cut_percent.toFixed(1));

        const qty_diff = flt(can_cut_quantity) - flt(d.order_quantity);
        const fob = flt(d.fob);
        const profit_loss_value = qty_diff * (fob * 0.7);
        frm.set_value('profit_loss_value', profit_loss_value);

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

        // ✅ Set custom status indicator FIRST
        if (!frm.doc.__islocal) {
            frm.page.clear_indicator();
            
            if (frm.doc.status === 'Pending for Approval') {
                frm.page.set_indicator(__('Pending for Approval'), 'orange');
            } else if (frm.doc.status === 'Pending Manager Approval') {
                frm.page.set_indicator(__('Pending Manager Approval'), 'yellow');
            } else if (frm.doc.status === 'Approved') {
                frm.page.set_indicator(__('Approved'), 'green');
            } else if (frm.doc.status === 'Rejected') {
                frm.page.set_indicator(__('Rejected'), 'red');
            } else if (frm.doc.docstatus === 0) {
                frm.page.set_indicator(__('Draft'), 'gray');
            } else if (frm.doc.docstatus === 1 && !frm.doc.status) {
                // Fallback for submitted docs without custom status
                frm.page.set_indicator(__('Submitted'), 'blue');
            } else if (frm.doc.docstatus === 2) {
                frm.page.set_indicator(__('Cancelled'), 'red');
            }
        }        

        const docKey = `Can Cut:${frm.doc.name}`;

        // Prevent duplicate execution for SAVED docs only
        if (!frm.doc.__islocal && window.can_cut_script.executed_for.has(docKey)) {
            console.log('🔄 Can Cut refresh: Already executed for', frm.doc.name);
            return;
        }

        console.log('✅ Can Cut refresh: Execution for', frm.doc.name);
        if (!frm.doc.__islocal) {
            window.can_cut_script.executed_for.add(docKey);
        }

        // Auto-set status on first save
        if (frm.doc.docstatus === 0 && !frm.doc.__islocal && !frm.doc.status) {
            frm.set_value('status', 'Pending for Approval');
        }

        const is_approver = frappe.user.has_role('Can Cut Approver');
        const is_manager = frappe.user.has_role('Can Cut Manager');
        const status = frm.doc.status;
        const is_pending_approver = (status === 'Pending for Approval');
        const is_pending_manager = (status === 'Pending Manager Approval');

        // Clear buttons
        frm.remove_custom_button('Approve');
        frm.remove_custom_button('Reject');
        frm.remove_custom_button('Final Approve');

        // Hide Save button if not in Draft
        if (!frm.doc.__islocal && (is_pending_approver || is_pending_manager || frm.doc.status !== 'Draft')) {
            frm.disable_save();
        } else {
            frm.enable_save();
        }

        // Make fields read-only only after save and not in Draft
        if (!frm.doc.__islocal && frm.doc.status && frm.doc.status !== 'Draft') {
            const editableInPendingApproval = [
                'actual_consumptions',
                'actual_dia',
                'actual_gsm',
                'actual_lay_length'
            ];

            // Define which fields should remain editable in "Pending for Approval"
            const editableFields = frm.doc.status === 'Pending for Approval'
                ? ['actual_consumption', 'actual_dia', 'actual_gsm', 'actual_lay_length']
                : [];

            Object.keys(frm.fields_dict).forEach(fieldname => {
                const isEditable = editableFields.includes(fieldname);
                frm.set_df_property(fieldname, 'read_only', !isEditable);
            });

            // Still disable Save button unless it's a draft
            // (approval workflows should use Approve/Reject buttons)
            frm.disable_save();
        }

        // Handle approval section
        if (frm.doc.__islocal) {
            if (frm.fields_dict.approval_section) {
                frm.set_df_property('approval_section', 'hidden', true);
            }
            return;
        }

        // === Handle both approver and manager states ===
        if ((is_approver && is_pending_approver) || (is_manager && is_pending_manager)) {
            console.log('✅ Showing approval section for:', is_manager ? 'Manager' : 'Approver');

            // Show approval section
            if (frm.fields_dict.approval_section) {
                frm.set_df_property('approval_section', 'hidden', false);
                frm.refresh_field('approval_section');
            }

            // Hide all other sections
            hide_all_sections_except(frm, ['approval_section']);

            if (frm.fields_dict.approver_remarks) {
                frm.set_df_property('approver_remarks', 'hidden', true);
                frm.refresh_field('approver_remarks');
            }

            if (frm.fields_dict.manager_remarks) {
                frm.set_df_property('manager_remarks', 'hidden', true);
                frm.refresh_field('manager_remarks');
            }

            // Inject card
            if (frm.fields_dict.approval_card_html) {
                // Fetch full names for Merchant (linked field) and Owner (Requested By)
                let merchantPromise = Promise.resolve('');
                let ownerPromise = Promise.resolve('');

                if (frm.doc.merchant) {
                    merchantPromise = frappe.call({
                        method: 'frappe.client.get_value',
                        args: { doctype: 'User', filters: { name: frm.doc.merchant }, fieldname: 'full_name' }
                    }).then(r => (r.message && r.message.full_name) || '');
                }

                if (frm.doc.owner) {
                    ownerPromise = frappe.call({
                        method: 'frappe.client.get_value',
                        args: { doctype: 'User', filters: { name: frm.doc.owner }, fieldname: 'full_name' }
                    }).then(r => (r.message && r.message.full_name) || '');
                }

                Promise.all([merchantPromise, ownerPromise]).then(([merchantName, ownerName]) => {
                    frm.doc.merchant_full_name = merchantName;
                    frm.doc.requested_by_full_name = ownerName;

                    const html = get_approval_card_html(frm);
                    frm.set_df_property('approval_card_html', 'options', html);
                    frm.set_df_property('approval_card_html', 'hidden', false);
                    frm.refresh_field('approval_card_html');

                    setTimeout(() => {
                        attach_approval_listeners(frm);
                    }, 100);
                });
            }
        } else if (frm.doc.status === 'Approved' || frm.doc.status === 'Rejected') {
            // ✅ Show approval card for completed statuses (read-only view for all users)
            console.log('✅ Showing read-only approval section for status:', frm.doc.status);

            if (frm.fields_dict.approval_section) {
                frm.set_df_property('approval_section', 'hidden', false);
                frm.refresh_field('approval_section');
            }

            // Inject read-only card
            if (frm.fields_dict.approval_card_html) {
                let merchantPromise = Promise.resolve('');
                let ownerPromise = Promise.resolve('');

                if (frm.doc.merchant) {
                    merchantPromise = frappe.call({
                        method: 'frappe.client.get_value',
                        args: { doctype: 'User', filters: { name: frm.doc.merchant }, fieldname: 'full_name' }
                    }).then(r => (r.message && r.message.full_name) || '');
                }

                if (frm.doc.owner) {
                    ownerPromise = frappe.call({
                        method: 'frappe.client.get_value',
                        args: { doctype: 'User', filters: { name: frm.doc.owner }, fieldname: 'full_name' }
                    }).then(r => (r.message && r.message.full_name) || '');
                }

                Promise.all([merchantPromise, ownerPromise]).then(([merchantName, ownerName]) => {
                    frm.doc.merchant_full_name = merchantName;
                    frm.doc.requested_by_full_name = ownerName;

                    const html = get_readonly_approval_card_html(frm);
                    frm.set_df_property('approval_card_html', 'options', html);
                    frm.set_df_property('approval_card_html', 'hidden', false);
                    frm.refresh_field('approval_card_html');
                });
            }
        } else {
            // Hide approval section for other statuses
            if (frm.fields_dict.approver_remarks) {
                if ((is_approver && is_pending_manager) || (is_manager && is_pending_approver) ) {
                    frm.set_df_property('approver_remarks', 'hidden', false);
                } else {
                    frm.set_df_property('approver_remarks', 'hidden', true);
                }
                frm.refresh_field('approver_remarks');
            }
        }

        // ✅ ONLY FOR NEW DOCS: Refresh fields to ensure they appear (after approval logic runs)
        if (frm.doc.__islocal) {
            setTimeout(() => {
                Object.keys(frm.fields_dict).forEach(fieldname => {
                    if (fieldname !== 'approval_card_html') { // Don't re-render HTML field
                        frm.refresh_field(fieldname);
                    }
                });
                // Ensure key sections are visible
                ['basic_details_section', 'fabric_details_section', 'consumption_details_section', 'order_and_cutting_calculation_section'].forEach(section => {
                    if (frm.fields_dict[section]) {
                        frm.set_df_property(section, 'hidden', false);
                    }
                });
            }, 200); // Short delay to ensure approval logic runs first
        }

        // Sync deviation_under from card to field (for both Approver & Manager)
        if (frm.fields_dict.deviation_under && !frm.doc.__islocal) {
            setTimeout(() => {
                const $wrapper = $(frm.fields_dict.approval_card_html.wrapper);
                const $select = $wrapper.find('.deviation-under');
                if ($select.length) {
                    $select.on('change', function() {
                        const val = $(this).val();
                        frm.set_value('deviation_under', val);
                    });
                }
            }, 300);
        }
    },

    sales_order: function(frm) {
        // ✅ If no Sales Order -> show nothing in Work Order
        if (!frm.doc.sales_order) {
            frm.set_value('work_order', '');
            frm.set_value('fob', 0);

            frm.set_query('work_order', function() {
                return { filters: { name: '0' } };
            });
            return;
        }

        frm.set_value('colour', '');
        frm.set_value('style', '');

        // ✅ If Cutting Kanban selected and cache loaded -> filter WOs by SO+WO combo
        if (frm.doc.cutting_kanban && frm.__cutting_kanban_cache?.loaded_for === frm.doc.cutting_kanban) {
            apply_work_order_filter_from_cutting_kanban(frm);
            auto_pick_single_work_order_safely(frm);
        } else {
            // Original behavior (only if no cutting_kanban)
            frm.set_query('work_order', { filters: { 'sales_order': frm.doc.sales_order, 'docstatus': 1 } });
            if (frm.doc.work_order) {
                frm.set_value('work_order', '');
            }
        }

        frappe.call({
            method: 'frappe.client.get_value',
            args: {
                doctype: 'Sales Order',
                fieldname: ['custom_fob', 'custom_merchant'], // Fetch both FOB and Merchant
                filters: { 'name': frm.doc.sales_order }
            },
            callback: function(r) {
                if (r.message) {
                    frm.set_value('fob', r.message.custom_fob || 0);
                    frm.set_value('merchant', r.message.custom_merchant || ''); // ✅ Set merchant
                }
            }
        });

        frappe.call({
            method: 'frappe.client.get',
            args: { doctype: 'Sales Order', name: frm.doc.sales_order, fields: ['items.item_code', 'items.custom_color'] },
            callback: function(r) {
                if (r.message?.items) {
                    const colors = [...new Set(r.message.items.map(item => item.custom_color).filter(Boolean))].sort();
                    frm.set_df_property('colour', 'options', colors);
                    frm.refresh_field('colour');
                }
            }
        });
    },

    work_order: function(frm) {
        if (!frm.doc.work_order) {
            frm.set_value('order_quantity', 0);
            frm.set_value('fabric_ordered', 0);
            frm.set_value('file_consumption', '');
            // frm.set_value('file_fabric_width', '');
            frm.set_value('file_dia', '');
            frm.set_value('file_gsm', '');
            frm.set_value('colour', '');
            frm.set_value('style', '');
            frm.trigger('recalculate');
            return;
        }
        frappe.call({
            method: 'frappe.client.get',
            args: { doctype: 'Work Order', name: frm.doc.work_order, fields: ['qty', 'production_item', 'bom_no'] },
            callback: function(r) {
                if (r.message) {
                    const wo = r.message;
                    frm.set_value('order_quantity', flt(wo.qty));
                    frm.set_value('colour', '');
                    frm.set_value('style', '');
                    if (wo.production_item) {
                        frappe.call({
                            method: 'frappe.client.get_value',
                            args: {
                                doctype: 'Item',
                                filters: { 'name': wo.production_item },
                                fieldname: ['custom_colour_name', 'custom_style_master']
                            },
                            callback: function(res) {
                                if (res.message) {
                                    frm.set_value('colour', res.message.custom_colour_name || '');
                                    frm.set_value('style', res.message.custom_style_master || '');
                                }
                                frappe.call({
                                    method: 'cuttingx.cuttingx.doctype.can_cut.can_cut.get_auto_fill_data_from_work_order',
                                    args: { work_order: frm.doc.work_order },
                                    callback: function(r) {
                                        const data = r.message || {};
                                        frm.set_value('fabric_ordered', flt(data.fabric_ordered || 0));
                                        frm.set_value('file_consumption', flt(data.file_consumption || 0));
                                        frm.set_value('file_gsm', flt(data.file_gsm || 0));
                                        // frm.set_value('file_fabric_width', flt(data.file_fabric_width || 0));
                                        frm.set_value('file_dia', flt(data.file_dia || 0));
                                        frm.set_value('file_lay_length', flt(data.file_lay_length || 0));
                                        frm.trigger('recalculate');
                                    }
                                });
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
            args: { doctype: 'Sales Order', name: frm.doc.sales_order, fields: ['items.item_code', 'items.custom_color'] },
            callback: function(r) {
                if (r.message) {
                    const items = r.message.items || [];
                    const matched_item = items.find(item => item.custom_color === frm.doc.colour);
                    if (matched_item && matched_item.item_code) {
                        frappe.call({
                            method: 'frappe.client.get_value',
                            args: {
                                doctype: 'Item',
                                filters: { 'name': matched_item.item_code },
                                fieldname: 'custom_style_master'
                            },
                            callback: function(res) {
                                frm.set_value('style', res.message?.custom_style_master || '');
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

function apply_work_order_filter_from_cutting_kanban(frm) {
    const allowedWOs = (frm.__cutting_kanban_cache.work_orders_by_so?.[frm.doc.sales_order] || []);

    if (!frm.doc.sales_order) {
        frm.set_query('work_order', function() {
            return { filters: { name: '0' } };
        });
        return;
    }

    frm.set_query('work_order', function() {
        if (!allowedWOs.length) return { filters: { name: '0' } };
        return {
            filters: {
                name: ['in', allowedWOs],
                sales_order: frm.doc.sales_order,
                docstatus: 1
            }
        };
    });

    if (frm.doc.work_order && !allowedWOs.includes(frm.doc.work_order)) {
        frm.set_value('work_order', '');
    }
}

function auto_pick_single_work_order_safely(frm) {
    const allowedWOs = (frm.__cutting_kanban_cache.work_orders_by_so?.[frm.doc.sales_order] || []);
    if (frm.doc.work_order || allowedWOs.length !== 1) return;

    const wo = allowedWOs[0];
    frappe.db.exists('Work Order', wo).then(exists => {
        if (exists) frm.set_value('work_order', wo);
    });
}

function flt(value, precision) {
    const val = parseFloat(value);
    if (isNaN(val)) return 0.0;
    const factor = precision ? Math.pow(10, precision) : 1000;
    return Math.round((val || 0) * factor) / factor;
}

function get_approval_card_html(frm) {
    const canCutPercent = parseFloat(frm.doc.can_cut_percent || 0);
    const canCutColor = canCutPercent >= 98 ? '#28a745' : '#dc3545';
    const canCutPercentFormatted = canCutPercent.toFixed(2);

    const profitLoss = flt(frm.doc.profit_loss_value);
    const profitLossColor = profitLoss >= 0 ? '#28a745' : '#dc3545';
    const profitLossSign = profitLoss >= 0 ? '+' : '';
    const profitLossFormatted = profitLossSign + profitLoss.toFixed(2);

    const deviationOptions = ['', 'Fabric', 'Production', 'Merchant'];
    let deviationSelectHTML = '<option value="">Select Reason</option>';
    deviationOptions.slice(1).forEach(option => {
        const selected = frm.doc.deviation_under === option ? 'selected' : '';
        deviationSelectHTML += `<option value="${option}" ${selected}>${option}</option>`;
    });

    return `
        <div class="approval-card" style="border: 1px solid #4c9658; padding: 20px; border-radius: 8px; max-width: 1200px; margin: 0 auto; background: white; font-family: Arial, sans-serif;">
            <h3 style="color: #4c9658; text-align: center; margin: 0 0 15px;">Can Cut % – Approval</h3>
            <div style="font-size: 0.9em; line-height: 1.6; margin-bottom: 15px;">
                <b>Request ID:</b> ${frm.doc.name} &nbsp; | &nbsp;
                <b>Status:</b> ${frm.doc.status}<br>
                <b>Style:</b> ${frm.doc.style || '–'} &nbsp; | &nbsp;
                <b>Sales Order:</b> ${frm.doc.sales_order || '–'} &nbsp; | &nbsp;
                <b>Work Order:</b> ${frm.doc.work_order || '–'} &nbsp; | &nbsp;
                <b>Colour:</b> ${frm.doc.colour || '–'}<br>
                <b>Merchant:</b> ${frm.doc.merchant_full_name || '–'}<br>
                <b>Requested By:</b> ${frm.doc.requested_by_full_name || '–'} &nbsp; | &nbsp;
                <b>On:</b> ${frappe.datetime.str_to_user(frm.doc.creation)}<br><br>
                <span style="color:#007bff;">
                <b>Requester Remarks:</b> ${frm.doc.requester_remarks ? frappe.utils.escape_html(String(frm.doc.requester_remarks)) : '–'}<br>
                ${frm.doc.status === 'Pending Manager Approval' ? `<b>Approver Remarks:</b> ${frm.doc.approver_remarks ? frappe.utils.escape_html(String(frm.doc.approver_remarks)) : '–'}<br>` : ''}
                ${frm.doc.status === 'Approved' || frm.doc.status === 'Rejected' ? `<b>Approver Remarks:</b> ${frm.doc.approver_remarks ? frappe.utils.escape_html(String(frm.doc.approver_remarks)) : '–'}<br>` : ''}
                ${frm.doc.status === 'Approved' || frm.doc.status === 'Rejected' ? `<b>Manager Remarks:</b> ${frm.doc.manager_remarks ? frappe.utils.escape_html(String(frm.doc.manager_remarks)) : '–'}<br>` : ''}
                </span>
            </div>

            <div style="margin: 15px 0; border-top: 1px solid #4c9658; padding-top: 15px; overflow-x: auto; text-align: center;">
                <b>SUMMARY</b><br>
                <table style="width: 60%; border-collapse: collapse; margin: 10px auto; table-layout: fixed; font-size: 1em;">
                    <thead>
                        <tr>
                            <th style="border: 1px solid #4c9658; padding: 6px; text-align: left; background: #f8f8f8; width: 25%;">Parameters</th>
                            <th style="border: 1px solid #4c9658; padding: 6px; text-align: center; background: #f8f8f8;">File Value</th>
                            <th style="border: 1px solid #4c9658; padding: 6px; text-align: center; background: #f8f8f8;">Actual Value</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td style="border: 1px solid #4c9658; padding: 6px; width: 25%; text-align: left;">
                                Fabric
                            </td>
                            <td style="border: 1px solid #4c9658; padding: 6px; text-align: center;">
                                ${flt(frm.doc.fabric_ordered)} kg
                            </td>
                            <td style="border: 1px solid #4c9658; padding: 6px; text-align: center;">
                                ${flt(frm.doc.fabric_issued)} kg
                            </td>
                        </tr>

                        <tr>
                            <td style="border: 1px solid #4c9658; padding: 6px; width: 25%; text-align: left;">
                                Order Qty
                            </td>
                            <td style="border: 1px solid #4c9658; padding: 6px; text-align: center;">
                                ${flt(frm.doc.order_quantity)} pcs
                            </td>
                            <td style="border: 1px solid #4c9658; padding: 6px; text-align: center;">
                                ${flt(frm.doc.can_cut_quantity)} pcs
                            </td>
                        </tr>

                        <tr>
                            <td style="border: 1px solid #4c9658; padding: 6px; width: 25%; text-align: left;">
                                Consumption
                            </td>
                            <td style="border: 1px solid #4c9658; padding: 6px; text-align: center;">
                                ${flt(frm.doc.file_consumption)} kg/pcs
                            </td>
                            <td style="border: 1px solid #4c9658; padding: 6px; text-align: center;">
                                ${flt(frm.doc.actual_consumption)} kg/pcs
                            </td>
                        </tr>

                        <tr>
                            <td style="border: 1px solid #4c9658; padding: 6px; width: 25%; text-align: left;">
                                Dia
                            </td>
                            <td style="border: 1px solid #4c9658; padding: 6px; text-align: center;">
                                ${flt(frm.doc.file_dia)} inch
                            </td>
                            <td style="border: 1px solid #4c9658; padding: 6px; text-align: center;">
                                ${flt(frm.doc.actual_dia)} inch
                            </td>
                        </tr>

                        <tr>
                            <td style="border: 1px solid #4c9658; padding: 6px; width: 25%; text-align: left;">
                                GSM
                            </td>
                            <td style="border: 1px solid #4c9658; padding: 6px; text-align: center;">
                                ${flt(frm.doc.file_gsm)}
                            </td>
                            <td style="border: 1px solid #4c9658; padding: 6px; text-align: center;">
                                ${flt(frm.doc.actual_gsm)}
                            </td>
                        </tr>

                        <tr>
                            <td style="border: 1px solid #4c9658; padding: 6px; width: 25%; text-align: left;">
                                Lay Consumption in Cms
                            </td>
                            <td style="border: 1px solid #4c9658; padding: 6px; text-align: center;">
                                ${frm.doc.file_lay_length || ""} cm
                            </td>
                            <td style="border: 1px solid #4c9658; padding: 6px; text-align: center;">
                                ${frm.doc.actual_lay_length || ""} cm
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>

            <div style="text-align: center; margin: 15px 0; color: ${canCutColor}; font-size: 1.1em;">
                <b>Can Cut %:</b>
                <span style="background-color: ${canCutColor}; color: white; padding: 4px 10px; border-radius: 4px; font-size: 0.9em; margin-left: 10px; font-weight: bold;">
                    ${canCutPercentFormatted}%
                </span>
            </div>

            <div style="text-align: center; margin: 15px 0; color: ${profitLossColor}; font-size: 1.1em;">
                <b>Profit / Loss Value:</b>
                <span style="background-color: ${profitLossColor}; color: white; padding: 4px 10px; border-radius: 4px; font-size: 0.9em; margin-left: 10px;">
                    ${profitLossFormatted}
                </span>
            </div>

            <div style="margin: 15px 0; border-top: 1px solid #4c9658; padding-top: 15px;">
                <label style="display: block; margin-bottom: 8px; font-size: 0.9em;">
                    Deviation Under ${profitLoss < 0 ? '<span style="color: red;">*</span>' : ''}
                </label>
                <select class="deviation-under" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px;">
                    ${deviationSelectHTML}
                </select>

                <label style="display: block; margin: 15px 0 8px; font-size: 0.9em;">
                    Remarks
                </label>
                <textarea class="approval-remarks" style="width: 100%; height: 80px; border: 1px solid #ddd; padding: 8px; border-radius: 4px;"></textarea>
            </div>

            <div style="margin: 15px 0; text-align: center;">
                <button type="button" class="btn-reject" style="background-color: #d9534f; color: white; border: none; padding: 8px 16px; margin: 0 10px; border-radius: 4px; cursor: pointer;">Reject</button>
                <button type="button" class="btn-approve" style="background-color: #5cb85c; color: white; border: none; padding: 8px 16px; margin: 0 10px; border-radius: 4px; cursor: pointer;">Approve</button>

                <label style="display: inline-flex; align-items: center; font-size: 0.9em;">
                    <input type="checkbox" class="with-replenishment" ${frm.doc.with_replenishment ? 'checked' : ''} style="margin-right: 8px;">
                    With Replenishment
                </label>
            </div>
        </div>
    `;
}

function attach_approval_listeners(frm) {
    const $wrapper = $(frm.fields_dict.approval_card_html.wrapper);
    const $card = $wrapper.find('.approval-card');

    if (!$card.length) {
        console.warn('❌ Approval card not found in DOM');
        return;
    }

    const profitLoss = flt(frm.doc.profit_loss_value);
    const status = frm.doc.status;

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

    $card.find('.btn-approve').off('click').on('click', function() {
        if (!validateDeviation()) return;

        const remarks = $card.find('.approval-remarks').val() || '';
        const deviation_under = $card.find('.deviation-under').val() || '';

        let method, args;

        if (status === 'Pending for Approval') {
            method = 'cuttingx.cuttingx.doctype.can_cut.can_cut.approve';
            args = { docname: frm.doc.name, approver_remarks: remarks, deviation_under: deviation_under };
        } else if (status === 'Pending Manager Approval') {
            method = 'cuttingx.cuttingx.doctype.can_cut.can_cut.approve_by_manager';
            args = { docname: frm.doc.name, manager_remarks: remarks, deviation_under: deviation_under };
        } else {
            frappe.msgprint(__('Invalid status for approval.'));
            return;
        }

        frappe.confirm(__('Approve this Can Cut?'), () => {
            frappe.call({
                method: method,
                args: args,
                callback: r => {
                    if (!r.exc) {
                        location.reload();
                    }
                }
            });
        });
    });

    $card.find('.btn-reject').off('click').on('click', function() {
        const reason = $card.find('.approval-remarks').val();
        if (!reason) {
            frappe.msgprint(__('Please enter remarks for rejection.'));
            return;
        }
        if (!validateDeviation()) return;

        const deviation_under = $card.find('.deviation-under').val() || '';

        frappe.call({
            method: 'cuttingx.cuttingx.doctype.can_cut.can_cut.reject',
            args: {
                docname: frm.doc.name,
                reason: reason,
                deviation_under: deviation_under
            },
            callback: r => {
                if (!r.exc) {
                    location.reload();
                }
            }
        });
    });
}

function hide_all_sections_except(frm, visible_section_fields) {
    Object.keys(frm.fields_dict).forEach(fieldname => {
        const df = frm.fields_dict[fieldname];
        if (df && df.df && df.df.fieldtype === 'Section Break') {
            frm.set_df_property(fieldname, 'hidden', !visible_section_fields.includes(fieldname));
        }
    });
}