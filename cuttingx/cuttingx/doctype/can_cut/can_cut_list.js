frappe.listview_settings['Can Cut'] = {
    add_fields: ["status", "docstatus"],

    has_indicator_for_draft: true,   // 🔥 THIS IS THE KEY

    get_indicator: function(doc) {

        const status = (doc.status || "").trim();

        if (status === "Approved") {
            return ["Approved", "green"];
        }

        if (status === "Rejected") {
            return ["Rejected", "red"];
        }

        if (status === "Pending for Approval") {
            return ["Pending for Approval", "orange"];
        }

        if (status === "Pending Manager Approval") {
            return ["Pending Manager Approval", "yellow"];
        }

        // fallback
        return ["Draft", "gray"];
    }
};
