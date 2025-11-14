// Copyright (c) 2025, Cognitonx Logic India Private Limited and contributors
// For license information, please see license.txt

frappe.ui.form.on("Bundle Creation", {
	onload: function (frm) {
		// Set filter for cut_docket_id
		frm.set_query("cut_docket_id", () => {
			return {
				filters: { name: ["in", get_eligible_cut_dockets()] },
			};
		});

		// Set filter for yarn_request_no
		frm.set_query("yarn_request_no", () => {
			return {
				filters: { name: ["in", get_eligible_yarn_requests()] },
			};
		});		

        frm.set_query("cut_confirmation_no", function() {
            if (!frm.doc.cut_docket_id) {
                return {
                    filters: { name: ["=", ""] }
                };
            }
            return {
                query: "cuttingx.cuttingx.doctype.bundle_creation.bundle_creation.get_eligible_cut_confirmations",
                filters: {
                    cut_docket_id: frm.doc.cut_docket_id
                }
            };
        });	
	},

	refresh: function (frm) {
		toggle_cut_flow_fields(frm);
		protect_child_table(frm);

		// Add "Create Bundles" button
		if (!frm.custom_bundle_button_added) {
			const grid = frm.fields_dict.table_bundle_details?.grid;
			if (grid) {
				grid.add_custom_button(
					__("Create Bundles"),
					function () {
						if (!frm.doc.__islocal && frm.doc.name) {
							generate_bundles(frm);
						} else {
							frappe.confirm(
								"This document must be saved before generating bundles. Do you want to save and continue?",
								() => {
									frm.save().then(() => {
										generate_bundles(frm);
									});
								}
							);
						}
					},
					__("Actions")
				);
				frm.custom_bundle_button_added = true;
			}
		}
	},

	cut_docket_id: function (frm) {
        if (frm.doc.cut_confirmation_no) {
            frm.set_value("cut_confirmation_no", "");
        }

		toggle_cut_flow_fields(frm);

		if (!frm.doc.cut_docket_id) {
			frappe.model.set_value(frm.doctype, frm.docname, "fg_item", "");
			frappe.after_ajax(() => setTimeout(() => protect_child_table(frm), 100));
			return;
		}

		frm.set_value("yarn_request_no", "");

		// Inject buttons
		inject_fetch_button(frm);		

		frappe.call({
			method: "frappe.client.get",
			args: {
				doctype: "Cut Docket",
				name: frm.doc.cut_docket_id,
			},
			async: false,
			callback: function (r) {
				if (r.message && r.message.style) {
					const style = r.message.style.trim();

					// Optional: Validate it's a real Item (recommended)
					frappe.db.exists("Item", style).then((exists) => {
						if (exists) {
							// Set value and refresh UI
							frappe.model.set_value(frm.doctype, frm.docname, "fg_item", style);
							frm.refresh_field("fg_item"); // 🔑 Critical for Link fields
						} else {
							frappe.msgprint(__("“{0}” is not a valid Item.", [style]));
							frappe.model.set_value(frm.doctype, frm.docname, "fg_item", "");
						}
					});
				} else {
					frappe.model.set_value(frm.doctype, frm.docname, "fg_item", "");
				}
			},
		});

		frappe.after_ajax(() => setTimeout(() => protect_child_table(frm), 100));
	},

	yarn_request_no: function (frm) {
		toggle_cut_flow_fields(frm);

		if (frm.doc.yarn_request_no) {
			frm.set_value("cut_docket_id", "");

			// Clear unrelated tables
			frm.clear_table("table_bundle_creation_components");
			frm.clear_table("table_shade_and_ply");
			frm.clear_table("table_bundle_creation_item");
			frm.refresh_field("table_bundle_creation_components");
			frm.refresh_field("table_shade_and_ply");
			frm.refresh_field("table_bundle_creation_item");

			// Step 1: Fetch Yarn Request
			frappe.call({
				method: "frappe.client.get",
				args: { doctype: "Knitting Yarn Request", name: frm.doc.yarn_request_no },
				callback: function (r) {
					if (!r.message) return;
					const yarn_req = r.message;
					const work_order = yarn_req.work_order;
					const style_number = yarn_req.style_number || "";
					const sales_order = yarn_req.sales_order || "";

					if (!work_order) {
						frappe.msgprint(__("Work Order not found in selected Yarn Request."));
						return;
					}

					// Step 2: Fetch Work Order
					frappe.call({
						method: "frappe.client.get",
						args: { doctype: "Work Order", name: work_order },
						callback: function (wo_res) {
							if (!wo_res.message) return;
							const wo = wo_res.message;
							const fg_item = wo.production_item;

							// Set main form fields
							frm.set_value({
								work_order: work_order,
								fg_item: fg_item,
								style_number: style_number,
								color: wo.custom_colour_name || "",
								sales_order: sales_order,
							});

							// Step 3: Populate table_bundle_creation_item
							const line_items = wo.custom_work_order_line_items || [];
							if (!line_items.length) {
								frappe.msgprint(__("No Line Items found in Work Order."));
								return;
							}

							line_items.forEach((li) => {
								const qty = parseFloat(li.work_order_allocated_qty || 0);
								if (qty <= 0) return;

								// const units_per_bundle = 10;
								// const bundles = Math.ceil(qty / units_per_bundle);

								const row = frm.add_child("table_bundle_creation_item");
								Object.assign(row, {
									work_order: work_order,
									sales_order: sales_order,
									line_item_no: li.line_item_no || li.idx,
									size: li.size || "",
									cut_quantity: qty,
									// unitsbundle: units_per_bundle,
									// no_of_bundles: bundles,
								});
							});

							frm.refresh_field("table_bundle_creation_item");
						},
					});
				},
			});
		} else {
			// Reset when Yarn Request is cleared
			frm.set_value({
				work_order: "",
				fg_item: "",
				style_number: "",
				color: "",
				sales_order: "",
			});
			frm.clear_table("table_bundle_creation_components");
			frm.clear_table("table_shade_and_ply");
			frm.clear_table("table_bundle_creation_item");
			frm.refresh_field("table_bundle_creation_components");
			frm.refresh_field("table_shade_and_ply");
			frm.refresh_field("table_bundle_creation_item");
		}
	},

	validate: function (frm) {
		const no_of_plies = frm.doc.no_of_plies || 0;
		const table = frm.doc.table_shade_and_ply || [];
		const total = table.reduce((sum, row) => sum + (row.ply_count || 0), 0);

		if (total > no_of_plies) {
			frappe.throw(
				__("Cannot save: Total Ply Count ({0}) exceeds No of Plies ({1}).", [
					total,
					no_of_plies,
				])
			);
		}
	},

	style_number: function (frm) {
		if (!frm.doc.style_number) {
			frm.clear_table("table_bundle_creation_components");
			frm.refresh_field("table_bundle_creation_components");
			return;
		}

		console.log("🎨 Style changed →", frm.doc.style_number);

		// Clear previous components
		frm.clear_table("table_bundle_creation_components");
		frm.refresh_field("table_bundle_creation_components");

		// Fetch Style Master → Style Group → Components
		frappe.call({
			method: "frappe.client.get",
			args: { doctype: "Style Master", name: frm.doc.style_number },
			callback: function (r) {
				if (!r.message || !r.message.style_group) {
					frappe.msgprint("⚠️ No Style Group linked to this Style Master.");
					return;
				}

				const style_group = r.message.style_group;
				console.log("🧩 Found Style Group:", style_group);

				frappe.call({
					method: "frappe.client.get",
					args: { doctype: "Style Group", name: style_group },
					callback: function (res) {
						if (!res.message) {
							frappe.msgprint("⚠️ Style Group not found.");
							return;
						}

						const comps = res.message.components || [];
						if (!comps.length) {
							frappe.msgprint("⚠️ No components found in Style Group.");
							return;
						}

						comps.forEach((comp) => {
							const row = frm.add_child("table_bundle_creation_components");
							row.component_name = comp.component_name;
							row.is_main = comp.is_main;
						});
						frm.refresh_field("table_bundle_creation_components");
					},
				});
			},
		});
	},
});

// Dynamically toggle shade/ply related fields & tables
function toggle_cut_flow_fields(frm) {
    const has_cut_docket = !!frm.doc.cut_docket_id;
    const has_yarn_request = !!frm.doc.yarn_request_no;
    const should_show_cut_fields = has_cut_docket && !has_yarn_request;

    // --- Top-level fields ---
    frm.toggle_display("no_of_plies", should_show_cut_fields);
	frm.set_df_property("no_of_plies", "reqd", should_show_cut_fields);
	frm.toggle_display("cut_confirmation_no", should_show_cut_fields);
	frm.set_df_property("cut_confirmation_no", "reqd", should_show_cut_fields);
    frm.toggle_display("table_shade_and_ply", should_show_cut_fields);

    // --- Child table: Bundle Creation Item ---
    updateChildTableColumns(frm, "table_bundle_creation_item", ["shade", "shade_cut_quantity", "ply"], should_show_cut_fields);

    // --- Child table: Bundle Details ---
    updateChildTableColumns(frm, "table_bundle_details", ["shade", "ply"], should_show_cut_fields);
}

// Helper function to update and refresh child table columns
function updateChildTableColumns(frm, table_fieldname, fields_to_toggle, should_show) {
    const grid = frm.fields_dict[table_fieldname]?.grid;

    if (grid) {
        for (let field_name of fields_to_toggle) {
            // Option 1: Using update_docfield_property (preferred)
            grid.update_docfield_property(field_name, 'hidden', should_show ? 0 : 1);
            
            /* 
            // Option 2: Direct manipulation of internal properties (if Option 1 fails)
            if (grid.fields_map && grid.fields_map[field_name]) {
                grid.fields_map[field_name].hidden = should_show ? 0 : 1;
            }
            */
        }
        
        // Ensure the grid re-renders its header and rows
        grid.visible_columns = undefined; // Force recalculation of visible columns
        grid.setup_visible_columns();
        
        // These calls ensure the UI reflects the changes
        if (grid.header_row && grid.header_row.wrapper) {
            grid.header_row.wrapper.remove();
        }
        delete grid.header_row;
        grid.make_head(); 
        
        for (let row of grid.grid_rows) {
            row.render_row();
        }
        
        frm.refresh_field(table_fieldname);
    }
}

// Child table: auto-cleanup bundle details when component removed
frappe.ui.form.on("Bundle Creation Components", {
	table_bundle_creation_components_remove: function (frm) {
		const current_components = (frm.doc.table_bundle_creation_components || [])
			.map((r) => r.component_name)
			.filter(Boolean);

		const before = frm.doc.table_bundle_details || [];
		const after = before.filter((r) => current_components.includes(r.component));

		if (after.length !== before.length) {
			frm.doc.table_bundle_details = after;
			frm.refresh_field("table_bundle_details");
			frappe.show_alert(__("Removed bundle details for deleted component(s)"));
		}
	},
});

// Inject "Fetch from Cut Docket" button
function inject_fetch_button(frm) {
	const fieldname = "table_bundle_creation_item";
	const grid = frm.fields_dict[fieldname]?.grid;
	if (!grid) return;
	if (grid.fetch_button_patched) return;

	const original_refresh = grid.refresh;
	grid.refresh = function () {
		original_refresh.apply(this, arguments);
		setTimeout(() => {
			if (!this.fetch_button_added) {
				this.add_custom_button(
					__("Fetch from Cut Docket"),
					() => fetch_and_split_data(frm),
					__("Actions")
				);
				this.fetch_button_added = true;
			}
		}, 100);
	};
	grid.fetch_button_patched = true;
	grid.refresh();
}

// Fetch & split data from Cut Docket
function fetch_and_split_data(frm) {
	if (!frm.doc.cut_docket_id) {
		frappe.msgprint(__("Please select a Cut Docket first."));
		return;
	}
    
	if (!frm.doc.cut_confirmation_no) {
        frappe.msgprint(__("Please select a Cut Confirmation first."));
        return;
    }

	frappe.call({
		method: "cuttingx.cuttingx.doctype.bundle_creation.bundle_creation.get_items_from_cut_confirmation",
		args: { cut_confirmation_no: frm.doc.cut_confirmation_no },
		callback: function (r) {
			if (!(r.message || []).length) {
				frappe.msgprint(__("No data found in Cut Confirmation for this Cut Docket."));
				return;
			}

			const shade_table = frm.doc.table_shade_and_ply;
			if (!shade_table?.length) {
				frappe.msgprint(__("Please define Shade and Ply details first."));
				return;
			}

			const no_of_plies = frm.doc.no_of_plies || 1;
			const sorted_items = [...r.message].sort((a, b) => a.idx - b.idx);
			frm.clear_table("table_bundle_creation_item");

			sorted_items.forEach((original_row) => {
				const size = original_row.size;
				const total_cut_qty = original_row.cut_quantity;
				let allocated = 0;
				const rows = [];

				shade_table.forEach((shade_row, idx) => {
					const shade_code = shade_row.shade_code;
					const pct = parseFloat(shade_row.shade_percent) || 0;
					const new_qty = Math.round((total_cut_qty * pct) / 100);
					if (new_qty <= 0 && idx !== shade_table.length - 1) return;
					allocated += new_qty;
					rows.push({
						work_order: original_row.work_order,
						sales_order: original_row.sales_order,
						line_item_no: original_row.line_item_no,
						size: size,
						cut_quantity: total_cut_qty,
						shade: shade_code,
						shade_cut_quantity: new_qty,
					});
				});

				if (rows.length > 0) {
					const last = rows[rows.length - 1];
					last.shade_cut_quantity += total_cut_qty - allocated;
					if (last.shade_cut_quantity < 0) last.shade_cut_quantity = 0;
				}

				rows.forEach((row) => {
					const shade_row = shade_table.find((s) => s.shade_code === row.shade);
					const start = shade_row?.start_ply_no || 1;
					const end = shade_row?.end_ply_no || 1;
					const child = frm.add_child("table_bundle_creation_item");
					Object.assign(child, row, {
						ply: `${start}-${end} of ${no_of_plies}`,
					});
				});
			});

			frm.refresh_field("table_bundle_creation_item");
		},
	});
}

// Shade & Ply table handlers
frappe.ui.form.on("Bundle Shade and Ply", {
	ply_count: function (frm, cdt, cdn) {
		const row = locals[cdt][cdn];
		const no_of_plies = frm.doc.no_of_plies || 0;
		if (row.ply_count && no_of_plies > 0) {
			const percent = (row.ply_count / no_of_plies) * 100;
			frappe.model.set_value(cdt, cdn, "shade_percent", `${percent.toFixed(1)}`);
		} else {
			frappe.model.set_value(cdt, cdn, "shade_percent", "");
		}

		const table = frm.doc.table_shade_and_ply;
		if (table?.length) {
			table.forEach((r) => calculate_ply_numbers(frm, r.doctype, r.name));
			frm.refresh_field("table_shade_and_ply");
		}
		validate_and_correct_ply_count(frm, cdt, cdn);
	},

	table_shade_and_ply_remove: function (frm) {
		const table = frm.doc.table_shade_and_ply;
		if (table?.length) {
			table.forEach((r) => calculate_ply_numbers(frm, r.doctype, r.name));
			frm.refresh_field("table_shade_and_ply");
		}
		validate_and_correct_ply_count(frm);
	},
});

// Bundle Creation Item handlers
frappe.ui.form.on("Bundle Creation Item", {
	unitsbundle: function (frm, cdt, cdn) {
		console.log("triggered");
		const row = locals[cdt][cdn];
		if (row.unitsbundle < 0) {
			frappe.msgprint(__("Units per Bundle cannot be negative"));
			frappe.model.set_value(cdt, cdn, "unitsbundle", 1);
		} else {
			calculate_bundles(frm, cdt, cdn);
		}
		frappe.after_ajax(() => {
			clean_and_recreate_balance_row(frm, cdt, cdn);
		});
	},
	no_of_bundles: function (frm, cdt, cdn) {
		clean_and_recreate_balance_row(frm, cdt, cdn);
	},
	"Bundle Creation Item": function (frm) {
		hide_add_delete_buttons(frm);
	},
});

// Helper functions
function get_eligible_cut_dockets() {
	let eligible = [];
	frappe.call({
		method: "cuttingx.cuttingx.doctype.bundle_creation.bundle_creation.get_eligible_cut_dockets",
		async: false,
		callback: function (r) {
			if (r.message) eligible = r.message;
		},
	});
	return eligible;
}

function get_eligible_yarn_requests() {
	let eligible = [];
	frappe.call({
		method: "cuttingx.cuttingx.doctype.bundle_creation.bundle_creation.get_eligible_yarn_requests",
		async: false,
		callback: function (r) {
			if (r.message) eligible = r.message;
		},
	});
	return eligible;
}

function calculate_ply_numbers(frm, cdt, cdn) {
	const row = locals[cdt][cdn];
	const table = frm.doc.table_shade_and_ply;
	if (!table) return;
	const sorted = [...table].sort((a, b) => a.idx - b.idx);
	let cumulative = 0;
	for (const r of sorted) {
		if (r.idx === row.idx) break;
		if (r.ply_count) cumulative += r.ply_count;
	}
	const start_ply = cumulative + 1;
	const end_ply = start_ply + (row.ply_count || 0) - 1;
	frappe.model.set_value(cdt, cdn, "start_ply_no", start_ply);
	frappe.model.set_value(cdt, cdn, "end_ply_no", end_ply);
}

function validate_and_correct_ply_count(frm, cdt, cdn) {
	const no_of_plies = frm.doc.no_of_plies || 0;
	const table = frm.doc.table_shade_and_ply || [];
	const total = table.reduce((sum, row) => sum + (row.ply_count || 0), 0);
	if (total > no_of_plies && cdt && cdn) {
		frappe.model.set_value(cdt, cdn, "ply_count", 0);
		frappe.model.set_value(cdt, cdn, "shade_percent", "");
		frappe.msgprint({
			title: __("Ply Count Exceeded"),
			message: __(
				"Total Ply Count ({0}) exceeds No of Plies ({1}).<br>Ply Count for this row has been reset.",
				[total, no_of_plies]
			),
			indicator: "orange",
		});
		frm.doc.table_shade_and_ply.forEach((r) => calculate_ply_numbers(frm, r.doctype, r.name));
		frm.refresh_field("table_shade_and_ply");
		return false;
	}
	return true;
}

function calculate_bundles(frm, cdt, cdn) {
	const row = locals[cdt][cdn];
	const table = frm.doc.table_bundle_creation_item || [];
	if (!row.unitsbundle) return;

	// 🧠 Determine base quantity source:
	const is_yarn_flow = !!frm.doc.yarn_request_no;
	const qty_field = is_yarn_flow ? "cut_quantity" : "shade_cut_quantity";
	const total_qty = parseFloat(row[qty_field] || 0);
	if (total_qty <= 0) return;

	const key_fields = is_yarn_flow
		? [row.work_order, row.sales_order, row.line_item_no, row.size]
		: [row.work_order, row.sales_order, row.line_item_no, row.size, row.shade];
	const key = key_fields.join("|");

	// Calculate remaining qty (for non-first rows)
	let allocated_before = 0;
	table.forEach((r) => {
		const comp_key = is_yarn_flow
			? [r.work_order, r.sales_order, r.line_item_no, r.size].join("|")
			: [r.work_order, r.sales_order, r.line_item_no, r.size, r.shade].join("|");
		if (comp_key === key && r.idx < row.idx) {
			allocated_before += (r.unitsbundle || 0) * (r.no_of_bundles || 0);
		}
	});

	const remaining_qty = Math.max(total_qty - allocated_before, 0);
	const units = row.unitsbundle || 1;
	const no_of_bundles = Math.floor(remaining_qty / units);
	const final_bundles = no_of_bundles > 0 ? no_of_bundles : remaining_qty > 0 ? 1 : 0;

	frappe.model.set_value(cdt, cdn, "no_of_bundles", final_bundles);
}

function clean_and_recreate_balance_row(frm, cdt, cdn) {
	const row = locals[cdt][cdn];
	const table = frm.doc.table_bundle_creation_item || [];

	// detect Yarn vs Cut Docket flow
	const is_yarn_flow = !!frm.doc.yarn_request_no;
	const qty_field = is_yarn_flow ? "cut_quantity" : "shade_cut_quantity";
	const total_qty = flt(row[qty_field] || 0);
	if (!total_qty || !row.unitsbundle || !row.no_of_bundles) return;

	// create row key based on flow
	const key = is_yarn_flow
		? [row.work_order, row.sales_order, row.line_item_no, row.size].join("|")
		: [row.work_order, row.sales_order, row.line_item_no, row.size, row.shade].join("|");

	const currentIdx = row.idx;

	// delete any future duplicate rows of same combination
	const to_delete = table.filter(
		(r) =>
			r.idx > currentIdx &&
			(is_yarn_flow
				? [r.work_order, r.sales_order, r.line_item_no, r.size].join("|") === key
				: [r.work_order, r.sales_order, r.line_item_no, r.size, r.shade].join("|") === key)
	);
	if (to_delete.length > 0) {
		to_delete.forEach((r) => frappe.model.clear_doc(r.doctype, r.name));
		frm.refresh_field("table_bundle_creation_item");
	}

	// recalc allocated total and base qty
	const related = (frm.doc.table_bundle_creation_item || []).filter((r) =>
		is_yarn_flow
			? [r.work_order, r.sales_order, r.line_item_no, r.size].join("|") === key
			: [r.work_order, r.sales_order, r.line_item_no, r.size, r.shade].join("|") === key
	);

	let total_allocated = 0,
		base_qty = 0;
	related.forEach((r) => {
		total_allocated += (r.unitsbundle || 0) * (r.no_of_bundles || 0);
		base_qty = flt(r[qty_field]) || base_qty;
	});

	const balance = base_qty - total_allocated;

	// if partial balance remains, add new row
	if (balance > 0 && balance < base_qty) {
		const currentIndex = frm.doc.table_bundle_creation_item.findIndex(
			(r) => r.name === row.name
		);

		const new_row = frappe.model.add_child(
			frm.doc,
			"Bundle Creation Item",
			"table_bundle_creation_item"
		);

		// insert directly after current
		frm.doc.table_bundle_creation_item.splice(
			currentIndex + 1,
			0,
			frm.doc.table_bundle_creation_item.pop()
		);

		Object.assign(new_row, {
			work_order: row.work_order,
			sales_order: row.sales_order,
			line_item_no: row.line_item_no,
			size: row.size,
			cut_quantity: is_yarn_flow ? row.cut_quantity : row.cut_quantity,
			shade: is_yarn_flow ? undefined : row.shade,
			ply: is_yarn_flow ? undefined : row.ply,
			shade_cut_quantity: is_yarn_flow ? undefined : base_qty,
			unitsbundle: balance,
			no_of_bundles: 1,
		});

		frm.doc.table_bundle_creation_item.forEach((r, i) => (r.idx = i + 1));
		frm.refresh_field("table_bundle_creation_item");
	}
}

function generate_bundles(frm) {
	const is_yarn_flow = !!frm.doc.yarn_request_no;

	frappe.call({
		method: "cuttingx.cuttingx.doctype.bundle_creation.bundle_creation.generate_bundle_details",
		args: {
			docname: frm.doc.name,
			is_yarn_flow: is_yarn_flow,
		},
		freeze: true,
		freeze_message: "Generating bundles...",
		callback: function (r) {
			if (!r.exc) {
				frappe.msgprint(__("✅ Bundles generated successfully."));
				frm.reload_doc();
			} else {
				frappe.msgprint(__("❌ Failed to generate bundles. Check server logs."));
			}
		},
	});
}

function protect_child_table(frm) {
	const fieldnames = ["table_bundle_creation_item", "table_bundle_details"];
	fieldnames.forEach((fieldname) => {
		const grid = frm.fields_dict[fieldname]?.grid;
		if (!grid) return;
		setTimeout(() => {
			if (grid.grid_buttons) {
				grid.grid_buttons.find(".grid-add-row").hide();
				grid.grid_buttons.find(".grid-remove-rows").hide();
			}
		}, 100);
		if (!grid.create_new_row_patched) {
			grid.create_new_row = function () {
				/* blocked */
			};
			grid.create_new_row_patched = true;
		}
		if (!grid.refresh_patched) {
			const original_refresh = grid.refresh;
			grid.refresh = function () {
				original_refresh.apply(this, arguments);
				setTimeout(() => {
					if (this.grid_buttons) {
						this.grid_buttons.find(".grid-add-row").hide();
						this.grid_buttons.find(".grid-remove-rows").hide();
					}
				}, 50);
			};
			grid.refresh_patched = true;
		}
	});
}
