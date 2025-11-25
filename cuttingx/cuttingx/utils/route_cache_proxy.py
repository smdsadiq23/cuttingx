def clear_route_cache_on_change(doc, method):
    """
    Proxy hook inside cuttingx that calls trackerx's route cache clear if available.
    Keeps cuttingx loosely coupled.
    """
    try:
        from trackerx_live.trackerx_live.utils.sequence_of_operation import (
            clear_opmap_cache_on_change as _clear,
        )
        _clear(doc, method)
    except Exception:
        # Swallow import errors if trackerx_live isn't installed on a site
        # (or log if you prefer)
        try:
            import frappe
            frappe.log_error("cuttingx: route cache proxy could not call trackerx cache clear")
        except Exception:
            pass
