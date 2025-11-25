# Copyright (c) 2025, Cognitonx Logic India Private Limited and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from frappe.utils import cint
import json
from collections import defaultdict, deque


class CutKitPlan(Document):
    def before_save(self):
        if not self.fg_item:
            return

        if not self.style or not self.colour:
            item_doc = frappe.get_cached_doc("Item", self.fg_item)
            if not self.style:
                self.style = item_doc.get("custom_style_master") or ""
            if not self.colour:
                self.colour = item_doc.get("custom_colour_name") or ""

    def _update_operation_map_and_last_operation(self, doc):
        """
        Populate table_operation_map and set last_operation from Process Map.

        - For each component in Process Map edges, we build a DAG (ops as nodes, edges as source->target).
        - We then run a stable Kahn topological sort per component (ties broken by original edge order and label),
        and append rows to `table_operation_map` in that order with a strictly increasing `sequence_no` per component.
        - `last_operation` is set to the unique sink (node with out-degree 0) if and only if there is exactly one
        sink across all components; otherwise it's left unchanged to avoid misleading UI.
        """
        # reset table
        doc.set("table_operation_map", [])

        if not doc.operation_map:
            return

        process_map = frappe.get_doc("Process Map", doc.operation_map)
        nodes = json.loads(process_map.nodes or "[]")
        edges = json.loads(process_map.edges or "[]")

        # id -> label
        node_id_to_label = {n.get("id"): n.get("label") for n in nodes if n.get("id")}

        # normalize edges: (source_label, target_label, components[], original_index)
        norm_edges = []
        for idx, e in enumerate(edges):
            s = node_id_to_label.get(e.get("source"))
            t = node_id_to_label.get(e.get("target"))
            comps = e.get("components") or []
            if not s or not t:
                continue
            # ensure list
            if isinstance(comps, str):
                comps = [comps]
            if not comps:
                # treat as "no component filter" edge — record as component=None bucket
                comps = [None]
            norm_edges.append((s, t, comps, idx))

        if not norm_edges:
            # fallback: best-effort last_operation from last target in the serialized edges
            if edges:
                last_target_id = edges[-1].get("target")
                doc.last_operation = node_id_to_label.get(last_target_id)
            return

        # gather all explicit component names including None bucket
        all_components = set()
        for _s, _t, comps, _i in norm_edges:
            for c in comps:
                all_components.add(c)

        # will collect sinks across all components to compute an overall last_operation
        global_sinks = set()

        # process per component
        for comp in sorted(all_components, key=lambda x: ("" if x is None else str(x)).lower()):
            # build adjacency and indegree only for this component
            adj = defaultdict(list)        # op -> list[(next_op, edge_idx)]
            indeg = defaultdict(int)       # op -> indegree count
            outdeg = defaultdict(int)      # op -> outdegree count
            ops_present = set()

            # collect nodes & edges
            for s, t, comps, edge_idx in norm_edges:
                if comp not in comps:
                    continue
                ops_present.add(s); ops_present.add(t)
                adj[s].append((t, edge_idx))
                indeg[t] += 1
                # ensure keys exist
                indeg.setdefault(s, indeg.get(s, 0))
                outdeg[s] += 1
                outdeg.setdefault(t, outdeg.get(t, 0))

            if not ops_present:
                continue

            # stable Kahn: queue of indegree==0, ordered by (label, first_edge_index)
            first_edge_index = {}
            for s, lst in adj.items():
                lst.sort(key=lambda it: it[1])  # stabilize adjacency by original edge order
                if lst:
                    first_edge_index[s] = min(idx for _, idx in lst)
            for op in ops_present:
                first_edge_index.setdefault(op, 10**9)

            q = [op for op in ops_present if indeg.get(op, 0) == 0]
            q.sort(key=lambda op: (first_edge_index.get(op, 10**9), str(op).lower()))
            q = deque(q)

            topo = []
            while q:
                u = q.popleft()
                topo.append(u)
                for v, _ei in adj.get(u, []):
                    indeg[v] -= 1
                    if indeg[v] == 0:
                        q.append(v)
                # keep queue stable
                q = deque(sorted(list(q), key=lambda op: (first_edge_index.get(op, 10**9), str(op).lower())))

            # If cycle (topo shorter), fall back to alphabetical to at least assign a stable order
            if len(topo) < len(ops_present):
                topo = sorted(list(ops_present), key=lambda op: str(op).lower())

            # build a quick edge lookup to decide next_operation for a source in this component
            has_edge = set()
            for s, t, comps, _ei in norm_edges:
                if comp in comps:
                    has_edge.add((s, t))

            # assign sequence numbers strictly increasing per component
            seq_no = 0
            # to generate rows, we want rows for each directed edge that exists in this component,
            # ordered by the topo order of its source op
            edge_rows = []
            topo_index = {op: i for i, op in enumerate(topo)}
            for s, t in sorted(has_edge, key=lambda st: (topo_index.get(st[0], 10**9), topo_index.get(st[1], 10**9))):
                seq_no += 1
                edge_rows.append((s, t, seq_no))

            # append to child table
            for s, t, seq in edge_rows:
                row = doc.append("table_operation_map", {})
                row.operation = s
                row.component = comp or ""   # store blank if None
                row.next_operation = t
                row.sequence_no = seq
                row.configs = {}

            # collect sinks for this component (outdeg==0)
            sinks = [op for op in ops_present if outdeg.get(op, 0) == 0]
            # if multiple sinks, include all; we'll resolve below
            for sk in sinks:
                global_sinks.add(sk)

        # decide last_operation: only if exactly one unique sink across all components
        if len(global_sinks) == 1:
            doc.last_operation = next(iter(global_sinks))
        # else: leave as-is (don’t overwrite with an arbitrary value)


    def _populate_physical_cell_first_and_last_operations(self, doc):
        """Populate table_physical_cell_first_and_last_operation with first & last operation per physical cell"""
        doc.set("table_physical_cell_first_and_last_operation", [])

        # Step 1: Get all active physical cells (excluding activation cell)
        physical_cells = frappe.get_all(
            "Physical Cell",
            filters={"name": ["!=", "QR/Barcode Cut Bundle Activation"]},
            pluck="name"
        )

        # Step 2: Build a mapping: operation → sequence_no from table_operation_map
        operation_sequence = {}
        for row in doc.table_operation_map:
            operation_sequence[row.operation] = row.sequence_no

        # Step 3: For each physical cell, find its operations that exist in the operation map
        for cell_name in physical_cells:
            # Get operations assigned to this cell from Physical Cell Operation
            cell_operations = frappe.get_all(
                "Physical Cell Operation",
                filters={"parent": cell_name},
                pluck="operation"
            )

            # Filter: Only keep operations that exist in the current operation map
            valid_operations = [
                op for op in cell_operations
                if op in operation_sequence
            ]

            if not valid_operations:
                continue  # Skip cells with no relevant operations

            # Sort by sequence_no from operation map
            sorted_ops = sorted(valid_operations, key=lambda op: operation_sequence[op])
            first_op = sorted_ops[0]
            last_op = sorted_ops[-1]

            # Append to new child table
            row = doc.append("table_physical_cell_first_and_last_operation", {})
            row.physical_cell = cell_name
            row.first_operation = first_op
            row.last_operation = last_op              


    # def _update_operation_map(self, doc):  # ✅ Added 'self'
    #     """Populate table_operation_map from selected Process Map"""
    #     doc.set("table_operation_map", [])
        
    #     process_map = frappe.get_doc("Process Map", doc.operation_map)
    #     nodes = json.loads(process_map.nodes or "[]")
    #     edges = json.loads(process_map.edges or "[]")
        
    #     node_id_to_label = {node["id"]: node["label"] for node in nodes}
    #     sequence_tracker = defaultdict(int)
        
    #     for edge in edges:
    #         source_op = node_id_to_label.get(edge["source"])
    #         target_op = node_id_to_label.get(edge["target"])
    #         components = edge.get("components", [])
            
    #         if not source_op or not target_op:
    #             continue
                
    #         for component in components:
    #             seq_key = f"{source_op}|{component}"
    #             sequence_tracker[seq_key] += 1
                
    #             row = doc.append("table_operation_map", {})
    #             row.operation = source_op
    #             row.component = component
    #             row.next_operation = target_op
    #             row.sequence_no = sequence_tracker[seq_key]
    #             row.configs = {}


    # # Previous Method replicated from TrackerX Live. Last Operation is not calculated correctly
    # def _set_last_operation(self, doc): 
    #     """Set last_operation using in-memory operation map data"""
    #     try:
    #         operation_data = []
    #         for row in doc.table_operation_map:
    #             operation_data.append({
    #                 'operation': row.operation,
    #                 'component': row.component,
    #                 'next_operation': row.next_operation,
    #                 'sequence_no': row.sequence_no or 1,
    #                 'configs': row.configs or {}
    #             })
            
    #         from trackerx_live.trackerx_live.utils.operation_map_util import OperationMapData
    #         operation_map = OperationMapData(f"CutKitPlan:{doc.name}")
    #         result = operation_map.build_from_operation_map(operation_data)
            
    #         if result.is_valid:
    #             doc.last_operation = operation_map.get_final_production_operation() or "Final QC"
    #         else:
    #             error_msg = "; ".join(result.errors)
    #             frappe.log_error(f"Invalid operation map in {doc.name}: {error_msg}")
    #             doc.last_operation = "Final QC"
                
    #     except Exception as e:
    #         frappe.log_error(f"Failed to set last_operation for {doc.name}: {str(e)}")
    #         doc.last_operation = "Final QC"


    # # Updated for giving correct last operation
    # def _set_last_operation(self, doc):
    #     """Set last_operation using in-memory operation map data"""
    #     try:
    #         # Convert in-memory table_operation_map to operation_data format
    #         operation_data = []
    #         all_operations = set()
            
    #         for row in doc.table_operation_map:
    #             operation_data.append({
    #                 'operation': row.operation,
    #                 'component': row.component,
    #                 'next_operation': row.next_operation,
    #                 'sequence_no': row.sequence_no or 1,
    #                 'configs': row.configs or {}
    #             })
    #             all_operations.add(row.operation)
    #             if row.next_operation:
    #                 all_operations.add(row.next_operation)

    #         # Add any final operations that are only targets (not sources)
    #         for op in all_operations:
    #             # If this op is never a source, add it as a terminal node
    #             if not any(d['operation'] == op for d in operation_data):
    #                 operation_data.append({
    #                     'operation': op,
    #                     'component': row.component,  # Use last component (or handle properly)
    #                     'next_operation': '',
    #                     'sequence_no': 1,
    #                     'configs': {}
    #                 })

    #         # Build OperationMapData directly
    #         from trackerx_live.trackerx_live.utils.operation_map_util import OperationMapData
    #         operation_map = OperationMapData(f"CutKitPlan:{doc.name}")
    #         result = operation_map.build_from_operation_map(operation_data)
            
    #         if result.is_valid:
    #             doc.last_operation = operation_map.get_final_production_operation() or "Final QC"
    #         else:
    #             error_msg = "; ".join(result.errors)
    #             frappe.log_error(f"Invalid operation map in {doc.name}: {error_msg}")
    #             doc.last_operation = "Final QC"
                
    #     except Exception as e:
    #         frappe.log_error(f"Failed to set last_operation for {doc.name}: {str(e)}")
    #         doc.last_operation = "Final QC"            


    # def _populate_physical_cell_last_operations(self, doc):
    #     """Populate table_physical_cell_last_operation for all active cells"""
    #     doc.set("table_physical_cell_last_operation", [])
        
    #     physical_cells = frappe.get_all(
    #         "Physical Cell",
    #         filters={"name": ["!=", "QR/Barcode Cut Bundle Activation"]},
    #         fields=["name"]
    #     )
        
    #     for cell in physical_cells:
    #         row = doc.append("table_physical_cell_last_operation", {})
    #         row.physical_cell = cell.name
    #         row.operation = doc.last_operation 
             

    def before_submit(self, doc=None, method=None): 
        """
        Before submitting Cut Kit Plan:
        1. Populate table_operation_map from Process Map
        2. Set last_operation using OperationMapManager
        3. Populate table_physical_cell_last_operation
        """
        # Handle Frappe's calling convention
        doc = doc or self
        
        if not doc.operation_map:
            frappe.throw("Process Map is mandatory for Cut Kit Plan submission.")

        # === STEP 1: Populate table_operation_map ===
        self._update_operation_map_and_last_operation(doc)

        # # === STEP 2: Set last_operation ===
        # self._set_last_operation(doc)

        # === STEP 3: Populate physical cell last operations ===
        # self._populate_physical_cell_last_operations(doc)
        self._populate_physical_cell_first_and_last_operations(doc)

        frappe.logger().info(f"Updated operations for Cut Kit Plan {doc.name}")          
                
                
@frappe.whitelist()
def filter_available_bundles(doctype, txt, searchfield, start, page_len, filters):
    """
    Return available Bundle Creation records:
    - Submitted (docstatus = 1)
    - Match search text
    - Have at least one unused production_item_number (not in Cut Kit Plan Bundle Details)
    - OR is the currently selected bundle (to allow editing)
    """
    current_bundle = (filters or {}).get("current_bundle")
    txt = txt or ""
    start = cint(start)
    page_len = cint(page_len) or 20

    # Step 1: Get all submitted bundles matching search (minimal SQL)
    bundles = frappe.db.sql("""
        SELECT name, fg_item
        FROM `tabBundle Creation`
        WHERE docstatus = 1
          AND (%(txt)s = '' OR name LIKE %(like_txt)s)
        ORDER BY creation DESC
    """, {
        "txt": txt,
        "like_txt": f"%{txt}%"
    }, as_dict=True)

    if not bundles:
        return []

    bundle_names = [b.name for b in bundles]

    # Step 2: Get all production_item_number -> bundle mapping for these bundles
    # (Only for 'Activation' & 'Completed' lines)
    bundle_to_items = frappe.db.sql("""
        SELECT 
            pi.production_item_number,
            tor.reference_order_number AS bundle_name
        FROM `tabProduction Item` pi
        INNER JOIN `tabTracking Order Bundle Configuration` tbc 
            ON pi.bundle_configuration = tbc.name
        INNER JOIN `tabTracking Order` tor 
            ON tbc.parent = tor.name
        WHERE tor.reference_order_number IN %(bundle_names)s
          AND tbc.source = 'Activation'
    """, {"bundle_names": bundle_names}, as_dict=True)

    # Step 3: Get all already-used production_item_number
    used_items = set(frappe.db.sql_list("""
        SELECT DISTINCT production_item_number
        FROM `tabCut Kit Plan Bundle Details`
        WHERE production_item_number IS NOT NULL
    """))

    # Step 4: For each bundle, check if it has ANY unused item
    available_bundles = []

    # Group items by bundle
    from collections import defaultdict
    items_by_bundle = defaultdict(list)
    for row in bundle_to_items:
        items_by_bundle[row.bundle_name].append(row.production_item_number)

    for bundle in bundles:
        name = bundle.name

        # Always include current bundle (even if fully used)
        if name == current_bundle:
            available_bundles.append((name, bundle.fg_item))
            continue

        items = items_by_bundle.get(name, [])
        if not items:
            continue  # no valid bundle lines

        # Check if ANY item is unused
        has_unused = any(item not in used_items for item in items)
        if has_unused:
            available_bundles.append((name, bundle.fg_item))

    # Step 5: Apply pagination (start, page_len)
    paginated = available_bundles[start : start + page_len]

    return paginated


@frappe.whitelist()
def get_auto_fill_data(fg_item):
    if not fg_item:
        return {}

    try:
        item_doc = frappe.get_cached_doc("Item", fg_item)
        style = item_doc.get("custom_style_master") or ""
        colour = item_doc.get("custom_colour_name") or ""
    except Exception:
        style = ""
        colour = ""

    bundle_info = frappe.db.sql("""
        SELECT bi.sales_order, bi.work_order
        FROM `tabBundle Creation Item` bi
        INNER JOIN `tabBundle Creation` b ON bi.parent = b.name
        WHERE b.fg_item = %s
        ORDER BY b.creation DESC
        LIMIT 1
    """, fg_item, as_dict=True)

    sales_order = bundle_info[0].sales_order if bundle_info else None
    work_order = bundle_info[0].work_order if bundle_info else None

    return {
        "sales_order": sales_order,
        "work_order": work_order,
        "style": style,
        "colour": colour
    }


# @frappe.whitelist()
# def filter_suppliers_by_order_method(doctype, txt, searchfield, start, page_len, filters):
#     order_method = filters.get("order_method")
#     if not order_method:
#         return []

#     suppliers = frappe.db.sql("""
#         SELECT DISTINCT sfg.supplier, sup.supplier_name
#         FROM `tabBOM Order Method Cost` omc
#         INNER JOIN `tabSupplier FG Items` sfg ON omc.parent = sfg.name
#         INNER JOIN `tabSupplier` sup ON sfg.supplier = sup.name
#         WHERE 
#             omc.omc_order_method = %s
#             AND sfg.supplier IS NOT NULL
#             AND (sup.name LIKE %s OR sup.supplier_name LIKE %s)
#         LIMIT %s OFFSET %s
#     """, (
#         order_method,
#         "%" + txt + "%",
#         "%" + txt + "%",
#         int(page_len),
#         int(start)
#     ))

#     return [(row[1] or row[0], row[0]) for row in suppliers if row[0]]


# Define operations to IGNORE (case-sensitive)
IGNORED_OPERATIONS = {
    "Activation",
    "UnLink Link",
    "Unlink",
    "Switch"
}

@frappe.whitelist()
def get_operations_from_process_map(process_map_name):
    """
    Fetches operation labels from 'nodes' in Process Map,
    excluding blacklisted operations.
    """
    if not process_map_name:
        return []

    try:
        doc = frappe.get_doc("Process Map", process_map_name)
    except frappe.DoesNotExistError:
        frappe.log_error(
            title="Process Map Not Found",
            message=f"Process Map '{process_map_name}' does not exist."
        )
        return []

    nodes = doc.get("nodes")
    if not nodes:
        return []

    try:
        if isinstance(nodes, str):
            data = frappe.parse_json(nodes)
        else:
            data = nodes
    except Exception as e:
        frappe.log_error(
            title="Process Map Parse Error",
            message=f"Invalid JSON in 'nodes' of Process Map '{process_map_name}': {str(e)}"
        )
        return []

    if not isinstance(data, list):
        return []

    operations = [
        node.get("label")
        for node in data
        if (
            isinstance(node, dict)
            and node.get("type") == "operationProcess"
            and node.get("label")
            and node.get("label") not in IGNORED_OPERATIONS  # ← FILTER HERE
        )
    ]

    return operations
    

# NEW: Single method to fetch both bundle details and unique components
@frappe.whitelist()
def get_bundle_details_with_components(bundle_creation_name):
    if not bundle_creation_name:
        return {"bundle_details": [], "unique_components": []}

    # Step 1: Fetch components from Bundle Creation in idx order
    bundle_creation_components = frappe.db.sql("""
        SELECT component_name
        FROM `tabBundle Creation Components`
        WHERE parent = %s
        ORDER BY idx
    """, bundle_creation_name, as_dict=True)

    # Maintain order and avoid duplicates while preserving first occurrence
    seen = set()
    unique_components = []
    for row in bundle_creation_components:
        comp = row.get("component_name")
        if comp and comp not in seen:
            unique_components.append(comp)
            seen.add(comp)

    if not unique_components:
        return {"bundle_details": [], "unique_components": []}

    # Create a set for fast lookup
    allowed_components = set(unique_components)

    # Step 2: Fetch bundle details from tracking system (as before)
    bundle_details = frappe.db.sql("""
        SELECT 
            pi.name AS 'production_item_id',  
            pi.production_item_number, 
            tbc.shade, 
            tbc.size, 
            tc.component_name AS 'component', 
            tbc.bundle_quantity AS 'bundle_qty' 
        FROM `tabProduction Item` pi
        INNER JOIN `tabTracking Order Bundle Configuration` tbc 
            ON pi.`bundle_configuration` = tbc.name
        INNER JOIN `tabTracking Order` tor 
            ON tbc.parent = tor.name
        INNER JOIN `tabTracking Component` tc 
            ON tc.parent = tor.name AND tbc.component = tc.name
        WHERE tor.`reference_order_number` = %s 
          AND tbc.source = 'Activation' 
        ORDER BY pi.bundle_configuration, pi.production_item_number
    """, bundle_creation_name, as_dict=True)

    if not bundle_details:
        return {"bundle_details": [], "unique_components": unique_components}

    # Log raw bundle details
    frappe.log_error(
        message=frappe.as_json(bundle_details, indent=2),
        title="Bundle Details (Raw) - get_bundle_details_with_components"
    )

    # Step 3: Get existing items in Cut Kit Plan to exclude
    existing_items = set(
        frappe.db.sql_list("""
            SELECT DISTINCT production_item_number 
            FROM `tabCut Kit Plan Bundle Details`
            WHERE production_item_number IS NOT NULL
        """)
    )

    # Step 4: Filter bundle details:
    # - Exclude already used production_item_numbers
    # - Only keep rows where component is in allowed_components
    filtered_bundle_details = [
        row for row in bundle_details
        if row.production_item_number not in existing_items
        and row.component in allowed_components
    ]

    # Optional: Sort bundle_details to follow component order
    # (Useful if UI groups by component)
    component_order = {comp: i for i, comp in enumerate(unique_components)}
    filtered_bundle_details.sort(
        key=lambda x: component_order.get(x.component, 999999)
    )

    # Log filtered
    frappe.log_error(
        message=frappe.as_json(filtered_bundle_details, indent=2),
        title="Filtered Bundle Details - get_bundle_details_with_components"
    )

    return {
        "bundle_details": filtered_bundle_details,
        "unique_components": unique_components  # now in idx order from Bundle Creation
    }