frappe.query_reports["Cutting Balance Report"] = {
  formatter(value, row, column, data, default_formatter) {
    const rendered = default_formatter(value, row, column, data, default_formatter);
    if (!data) return rendered;

    if (column.fieldname === "Remarks") {
      const safe = frappe.utils.escape_html(value || "");
      const docname = data["OCN"]; // Sales Order name
      return `
        <textarea class="report-remark-input"
                  data-docname="${docname}"
                  rows="2"
                  style="width:100%; box-sizing:border-box; padding:4px 6px; resize:vertical;">${safe}</textarea>
      `;
    }
    return rendered;
  },

  onload(report) {
    const $wrap = report.page.wrapper;

    const save = frappe.utils.debounce(function (e) {
      const $el = $(e.currentTarget);
      const name = $el.attr("data-docname");
      const value = $el.val();
      $el.css("opacity", 0.6);

      frappe.call({
        method: "frappe.client.set_value",
        args: {
          doctype: "Sales Order",
          name,
          fieldname: "custom_report_remarks",
          value
        },
        callback() {
          frappe.show_alert({ message: __("Remarks saved"), indicator: "green" });
        },
        always() { $el.css("opacity", 1); },
        error()  { frappe.msgprint(__("Could not save remarks")); }
      });
    }, 400);

    $wrap.on("change", ".report-remark-input", save);
    $wrap.on("blur",   ".report-remark-input", save);
  }
};
