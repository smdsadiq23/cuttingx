frappe.query_reports["Cutting completion Report"] = {
    hasRole(role) {
        if (frappe.user?.has_role) return frappe.user.has_role(role);
        const roles =
            frappe.boot?.user_info?.[frappe.session.user]?.roles || frappe.user_roles || [];
        return Array.isArray(roles) && roles.includes(role);
    },

    formatter(value, row, column, data, default_formatter) {
        const html = default_formatter(value, row, column, data, default_formatter);
        if (!data) return html;

        const fieldname = (column.fieldname || "").toLowerCase();
        const isStatus = fieldname === "status";
        const isFolding = fieldname === "folding";
        const isEndBit = fieldname === "end_bit";

        // Handle Folding and End Bit
        if (isFolding || isEndBit) {
            const docname = data.can_cut_name;
            if (!docname) return html;  // ← Will be empty if no Can Cut exists

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
            const currentValue = value || "Pending for Approval";
            const isFactoryManager = this.hasRole("Factory Manager");

            const opts = ["Pending for Approval"];
            if (isFactoryManager) opts.push("Approved");

            if (data.is_first_row) {
                const options = opts.map(opt =>
                    `<option value="${opt}" ${opt === currentValue ? "selected" : ""}>${opt}</option>`
                ).join("");

                return `
                    <select class="report-status-select"
                            data-docname="${docname}"
                            data-doctype="Sales Order"
                            data-fieldname="custom_consumption_status"
                            style="width:100%; padding:4px; border-radius:4px;">
                        ${options}
                    </select>
                `;
            } else {
                return `<span>${frappe.utils.escape_html(currentValue)}</span>`;
            }
        }

        return html;
    },

    onload(report) {
        const $wrap = report.page.wrapper;

        setTimeout(() => {
            const columns = report.get_columns() || [];
            columns.forEach(c => {
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

			if (fieldname === "custom_consumption_status" && value === "Approved") {
				const isAllowed = this.hasRole("Factory Manager");
				if (!isAllowed) {
					frappe.msgprint(__("Only Factory Manager can set status to 'Approved'"));
					$el.val($el.data("old-value"));
					return;
				}

				// Get all rows for this OCN
				const ocn = docname;
				const relatedRows = report.data.filter(row => row.ocn === ocn);

				// Define required fields and their human-readable labels
				const requiredFields = [
					{ key: "fabric_ordered", label: "Fabric Ordered" },
					{ key: "fabric_issued", label: "Fabric Issued" },
					{ key: "folding", label: "Folding" },
					{ key: "end_bit", label: "End Bit" },
					{ key: "file_consumption", label: "File Consumption" },
					{ key: "actual_consumption", label: "Actual Consumption" }
				];

				const missingFields = [];

				relatedRows.forEach(row => {
					requiredFields.forEach(field => {
						const val = row[field.key];
						if (!val || String(val).trim() === "") {
							if (!missingFields.includes(field.label)) {
								missingFields.push(field.label);
							}
						}
					});
				});

				if (missingFields.length > 0) {
					const message = `Cutting flow not completed. Cannot approve.<br><br>Missing: <b>${missingFields.join(", ")}</b>`;
					frappe.msgprint({
						title: __('Approval Blocked'),
						indicator: 'red',
						message: __(message)
					});
					$el.val($el.data("old-value"));
					return;
				}

                // ✅ If valid, auto-set approved_by and approved_on
                const args = {
                    doctype: "Sales Order",
                    name: docname,
                    fieldname: "custom_consumption_status",
                    value: "Approved",
                    custom_approved_by: frappe.session.user,
                    custom_approved_on: frappe.datetime.now_datetime()
                };                
			}

            $el.css("opacity", 0.6);
            frappe.call({
                method: "frappe.client.set_value",
                args: { doctype, name: docname, fieldname, value },
                callback(r) {
                    if (!r.exc) {
                        frappe.show_alert({ message: __("Saved"), indicator: "green" });
                        $el.data("old-value", value);
                    } else {
                        frappe.msgprint(__("Save failed"));
                    }
                },
                always() {
                    $el.css("opacity", 1);
                }
            });
        }.bind(this), 600);

        $wrap.on("focus", ".report-editable-field, .report-status-select", function () {
            $(this).data("old-value", $(this).val());
        });

        $wrap.on("blur", ".report-editable-field", save);
        $wrap.on("change", ".report-status-select", save);
    }
};