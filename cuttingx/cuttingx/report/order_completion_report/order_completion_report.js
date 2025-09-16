
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

        // Handle Folding and End Bit (editable from Can Cut)
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

        // Handle Status Dropdown (Sales Order status)
        if (isStatus) {
            const docname = data.ocn;
            const currentValue = value || "";
            const isFactoryManager = frappe.boot.user_roles.includes("System Manager");

            let options = ['<option value=""></option>'];
            ["Pending", "In Progress", "Completed"].forEach(opt => {
                const selected = opt === currentValue ? "selected" : "";
                options.push(`<option value="${opt}" ${selected}>${opt}</option>`);
            });

            if (isFactoryManager) {
                const selected = "Approved" === currentValue ? "selected" : "";
                options.push(`<option value="Approved" ${selected}>Approved</option>`);
            }

            return `
                <select class="report-status-select"
                        data-docname="${docname}"
                        data-doctype="Sales Order"
                        data-fieldname="custom_consumption_status"
                        style="width:100%; padding:4px; border-radius:4px;">
                    ${options.join("")}
                </select>
            `;
        }

        return html;
    },

    onload(report) {
        const $wrap = report.page.wrapper;

        // Mark editable fields
        report.columns.forEach(c => {
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

            // Prevent non-Managers from setting Approved
            if (fieldname === "custom_consumption_status" && value === "Approved") {
                if (!frappe.boot.user_roles.includes("Factory Manager")) {
                    frappe.msgprint("Only Factory Manager can set status to 'Approved'");
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
                    value: value
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
                }
            });
        }, 600);

        // Track original value
        $wrap.on("focus", ".report-editable-field, .report-status-select", function () {
            $(this).data("old-value", $(this).val());
        });

        // Save on blur/change
        $wrap.on("blur", ".report-editable-field", save);
        $wrap.on("change", ".report-status-select", save);
    }
};
