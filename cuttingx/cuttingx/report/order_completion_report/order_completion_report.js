frappe.query_reports["Order Completion Report"] = {
	formatter(value, row, column, data, default_formatter) {
		const html = default_formatter(value, row, column, data, default_formatter);
		if (!data) return html;

		const fieldname = (column.fieldname || "").toLowerCase();
		const isStatus = fieldname === "status";
		const isFolding = fieldname === "folding";
		const isEndBit = fieldname === "end_bit";

		const docname = data["OCN"] || data["ocn"];
		const canCutDocname = data["can_cut_name"]; // ← We need this!

		// If we don't have Can Cut name, fallback to Sales Order
		const targetDocname = canCutDocname || docname;
		const targetDoctype = canCutDocname ? "Can Cut" : "Sales Order";
		const targetFieldname = fieldname;

		if (isFolding || isEndBit) {
			const safeValue = frappe.utils.escape_html(value || "");
			return `
            <textarea class="report-editable-field"
                      data-docname="${targetDocname}"
                      data-doctype="${targetDoctype}"
                      data-fieldname="${targetFieldname}"
                      rows="1"
                      style="width:100%; box-sizing:border-box; padding:4px; resize:vertical;">${safeValue}</textarea>
        `;
		}

        if (isStatus) {
            const docname = data["OCN"] || data["ocn"];
            const currentValue = value || "";
            const isFactoryManager = frappe.boot.user_roles.includes("Factory Manager");

            // Build options dynamically
            let options = ['<option value=""></option>'];
            
            ["Pending", "In Progress", "Completed"].forEach(opt => {
                const selected = opt === currentValue ? "selected" : "";
                options.push(`<option value="${opt}" ${selected}>${opt}</option>`);
            });

            // Only Factory Manager can see and select "Approved"
            if (isFactoryManager) {
                const selected = "Approved" === currentValue ? "selected" : "";
                options.push(`<option value="Approved" ${selected}>Approved</option>`);
            }

            return `
                <select class="report-status-select"
                        data-docname="${docname}"
                        data-fieldname="custom_consumption_status"
                        style="width:100%; padding:4px; border: 1px solid #d1d8dd; border-radius: 4px;">
                    ${options.join("")}
                </select>
            `;
        }

		return html;
	},
	onload(report) {
		const $wrap = report.page.wrapper;

		// Mark columns as editable
		(report.columns || []).forEach((c) => {
			if (["status", "folding", "end_bit"].includes((c.fieldname || "").toLowerCase())) {
				c.editable = 1;
			}
		});

		const save = frappe.utils.debounce(function (e) {
			const $el = $(e.currentTarget);
			const docname = $el.data("docname");
			const doctype = $el.data("doctype");
			const fieldname = $el.data("fieldname");
			const value = $el.val();

			// Skip if no change
			if (value === (e.originalValue || "")) return;

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
						frappe.show_alert({
							message: __("Saved"),
							indicator: "green",
						});
						$el.removeClass("unsaved").data("original-value", value);
					} else {
						frappe.msgprint(__("Save failed"));
					}
				},
				always() {
					$el.css("opacity", 1);
				},
			});
		}, 600);

		// Track original values
		$wrap.on("focus", ".report-editable-field", function () {
			$(this).data("original-value", $(this).val());
		});

		// Save on blur or change
		$wrap.on("blur", ".report-editable-field", save);
		$wrap.on("change", ".report-editable-field", save);
	}
};
