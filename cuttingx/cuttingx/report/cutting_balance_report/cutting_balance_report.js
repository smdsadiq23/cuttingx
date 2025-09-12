frappe.query_reports["Cutting Balance Report"] = {
  formatter(value, row, column, data, default_formatter) {
    const html = default_formatter(value, row, column, data, default_formatter);
    if (!data) return html;

    const isRemarks =
      (column.fieldname && column.fieldname.toLowerCase() === "remarks") ||
      (column.label && column.label.trim() === "Remarks");

    if (isRemarks) {
      const safe = frappe.utils.escape_html(value || "");
      const docname = data["OCN"] || data["ocn"]; // Sales Order name
      return `
        <textarea class="report-remark-input"
                  data-docname="${docname}"
                  rows="2"
                  style="width:100%; box-sizing:border-box; padding:4px 6px; resize:vertical;">${safe}</textarea>
      `;
    }
    return html;
  },

  onload(report) {
    const $wrap = report.page.wrapper;

    // force text alignment/type (optional but nice)
    (report.columns || []).forEach(c => {
      if ((c.fieldname || "").toLowerCase() === "remarks" || c.label === "Remarks") {
        c.fieldtype = "Data";
        c.align = "left";
      }
    });

    const save = frappe.utils.debounce(function (e) {
      const $el = $(e.currentTarget);
      $el.css("opacity", 0.6);
      frappe.call({
        method: "frappe.client.set_value",
        args: {
          doctype: "Sales Order",
          name: $el.attr("data-docname"),
          fieldname: "custom_report_remarks",   // <-- your fieldname
          value: $el.val()
        },
        callback() { frappe.show_alert({message: __("Remarks saved"), indicator: "green"}); },
        always() { $el.css("opacity", 1); }
      });
    }, 400);

    $wrap.on("change", ".report-remark-input", save);
    $wrap.on("blur",   ".report-remark-input", save);
  }
};
