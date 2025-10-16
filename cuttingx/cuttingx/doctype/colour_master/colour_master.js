// Copyright (c) 2025, Cognitonx Logic India Private limited and contributors
// For license information, please see license.txt

frappe.ui.form.on('Colour Master', {
    hex: function(frm) {
        console.log("Rechead Here")
        update_rgb(frm);
    }
});

function update_rgb(frm) {
    console.log("reached here")
    const hex = frm.doc.hex;
    if (!hex) {
        frm.set_value('rgb', '');
        return;
    }

    try {
        let h = hex.replace('#', '');
        if (h.length === 3) {
            h = h.split('').map(c => c + c).join('');
        }
        if (h.length !== 6) {
            throw new Error('Invalid hex length');
        }

        const r = parseInt(h.substring(0, 2), 16);
        const g = parseInt(h.substring(2, 4), 16);
        const b = parseInt(h.substring(4, 6), 16);

        if ([r, g, b].some(isNaN)) {
            throw new Error('Invalid hex value');
        }

        frm.set_value('rgb', `${r},${g},${b}`);
    } catch (e) {
        console.warn('Invalid HEX:', hex, e);
        frm.set_value('rgb', '');
    }
}