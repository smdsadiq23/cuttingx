frappe.query_reports["Cutting Completion Report"] = {
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

            // ✅ Fixed: Use `this` instead of wrong report name
            if (fieldname === "custom_consumption_status" && value === "Approved") {
                const ok = this.hasRole("Factory Manager");
                if (!ok) {
                    frappe.msgprint(__("Only Factory Manager can set status to 'Approved'"));
                    $el.val($el.data("old-value"));
                    return;
                }
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
        }.bind(this), 600);  // Bind `this` context

        $wrap.on("focus", ".report-editable-field, .report-status-select", function () {
            $(this).data("old-value", $(this).val());
        });

        $wrap.on("blur", ".report-editable-field", save);
        $wrap.on("change", ".report-status-select", save);
    }
};