// Copyright (c) 2025, Cognitonx Logic India Private limited and contributors
// For license information, please see license.txt

frappe.query_reports["Order Completion Report"] = {
	formatter(value, row, column, data, default_formatter) {
		const html = default_formatter(value, row, column, data, default_formatter);
		if (!data) return html;

		const fieldname = (column.fieldname || "").toLowerCase();
		const isStatus = fieldname === "status";
		const isFolding = fieldname === "folding";
		const isEndBit = fieldname === "end_bit";

		// ✅ Safe role check
		const user_roles = frappe.boot?.user_info?.roles;
		const isSystemManager = Array.isArray(user_roles) && user_roles.includes("Factory Manager");

		// Handle Folding and End Bit
		if (isFolding || isEndBit) {
			const docname = data.can_cut_name;
			if (!docname) return html;

			const safeValue = frappe.utils.escape_html(value || "");
			return `
            <textarea class="report-editable-field"
                      data-docname="${docname}"
                      data-doctype="Can Cut"
                      data-fieldname="${fieldname}"
                      rows="1"
                      style="width:100%; padding:4px; resize:vertical;">${safeValue}</textarea>
        `;
		}

		// Handle Status Dropdown
		if (isStatus) {
			const docname = data.ocn;
			const currentValue = value || "Pending for Approval"; // Default if blank
			const isFactoryManager =
				Array.isArray(frappe.boot?.user_info?.roles) &&
				frappe.boot.user_info.roles.includes("Factory Manager");

			let options = [];
			["Pending for Approval"].forEach((opt) => {
				const selected = opt === currentValue ? "selected" : "";
				options.push(`<option value="${opt}" ${selected}>${opt}</option>`);
			});

			if (isFactoryManager) {
				const selected = "Approved" === currentValue ? "selected" : "";
				options.push(`<option value="Approved" ${selected}>Approved</option>`);
			}

			// Only show dropdown on first row for this OCN
			if (data.is_first_row) {
				return `
            <select class="report-status-select"
                    data-docname="${docname}"
                    data-doctype="Sales Order"
                    data-fieldname="custom_consumption_status"
                    style="width:100%; padding:4px; border-radius:4px;">
                ${options.join("")}
            </select>
        `;
			} else {
				// Show current value on other rows
				return `<span>${frappe.utils.escape_html(currentValue)}</span>`;
			}
		}

		return html;
	},

	onload(report) {
		const $wrap = report.page.wrapper;

		// Use report.get_columns() or wait for report.data
		setTimeout(() => {
			const columns = report.get_columns() || [];
			columns.forEach((c) => {
				if (["status", "folding", "end_bit"].includes((c.fieldname || "").toLowerCase())) {
					c.editable = 1;
				}
			});
		}, 500);

		const save = frappe.utils.debounce(function (e) {
			const $el = $(e.currentTarget);
			const docname = $el.data("docname");
			const doctype = $el.data("doctype");
			const fieldname = $el.data("fieldname");
			const value = $el.val();

			// Use safe role check
			const user_roles = frappe.boot?.user_info?.roles || [];
			if (fieldname === "custom_consumption_status" && value === "Approved") {
				if (!user_roles.includes("System Manager")) {
					frappe.msgprint("Only System Manager can set status to 'Approved'");
					$el.val($el.data("old-value"));
					return;
				}
			}

			$el.css("opacity", 0.6);
			frappe.call({
				method: "frappe.client.set_value",
				args: {
					doctype: doctype,
					name: docname,
					fieldname: fieldname,
					value: value,
				},
				callback(r) {
					if (!r.exc) {
						frappe.show_alert({ message: "Saved", indicator: "green" });
						$el.data("old-value", value);
					} else {
						frappe.msgprint("Save failed");
					}
				},
				always() {
					$el.css("opacity", 1);
				},
			});
		}, 600);

		$wrap.on("focus", ".report-editable-field, .report-status-select", function () {
			$(this).data("old-value", $(this).val());
		});

		$wrap.on("blur", ".report-editable-field", save);
		$wrap.on("change", ".report-status-select", save);
	},
};
