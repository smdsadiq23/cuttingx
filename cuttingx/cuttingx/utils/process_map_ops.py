# cuttingx/cuttingx/utils/process_map_ops.py

from __future__ import annotations

import frappe
import json
from collections import defaultdict, deque
from frappe.utils import cint

# Define operations to IGNORE (case-sensitive)
IGNORED_OPERATIONS = {
    "Activation",
    "UnLink Link",
    "Unlink",
    "Switch",
}


def get_operations_from_process_map_core(process_map_name: str):
    """
    Core utility to fetch operation labels from 'nodes' in Process Map in their
    correct sequential order based on edges, excluding blacklisted operations.

    This is non-whitelisted; use thin @frappe.whitelist() wrappers in doctypes
    (Cut Kit Plan, Work Order, etc.) to expose it to the client.
    """
    if not process_map_name:
        return []

    try:
        doc = frappe.get_doc("Process Map", process_map_name)
    except frappe.DoesNotExistError:
        frappe.log_error(
            title="Process Map Not Found",
            message=f"Process Map '{process_map_name}' does not exist.",
        )
        return []

    # Parse nodes
    nodes_data = doc.get("nodes")
    if not nodes_data:
        return []

    try:
        if isinstance(nodes_data, str):
            nodes = frappe.parse_json(nodes_data)
        else:
            nodes = nodes_data
    except Exception as e:
        frappe.log_error(
            title="Process Map Nodes Parse Error",
            message=f"Invalid JSON in 'nodes' of Process Map '{process_map_name}': {str(e)}",
        )
        return []

    if not isinstance(nodes, list):
        return []

    # Parse edges
    edges_data = doc.get("edges")
    edges = []

    if edges_data:
        try:
            if isinstance(edges_data, str):
                edges = frappe.parse_json(edges_data)
            else:
                edges = edges_data
        except Exception as e:
            frappe.log_error(
                title="Process Map Edges Parse Error",
                message=f"Invalid JSON in 'edges' of Process Map '{process_map_name}': {str(e)}",
            )
            # Continue without edges - will return unordered list
            edges = []

    # Filter operation nodes only
    operation_nodes = [
        node
        for node in nodes
        if (
            isinstance(node, dict)
            and node.get("type") == "operationProcess"
            and node.get("label")
            and node.get("label") not in IGNORED_OPERATIONS
        )
    ]

    if not operation_nodes:
        return []

    # If no edges, return nodes in their original order
    if not edges or not isinstance(edges, list):
        return [node.get("label") for node in operation_nodes]

    # Build graph from edges: source -> target mapping
    graph = {}
    for edge in edges:
        if isinstance(edge, dict) and edge.get("source") and edge.get("target"):
            graph[edge["source"]] = edge["target"]

    # Create a map of node_id -> node_label for operation nodes only
    node_id_to_label = {node["id"]: node["label"] for node in operation_nodes}

    # Find the starting node (node with no incoming edges)
    all_targets = {edge.get("target") for edge in edges if isinstance(edge, dict)}
    all_sources = {edge.get("source") for edge in edges if isinstance(edge, dict)}

    # Start node is in sources but not in targets (or is the first node if no clear start)
    start_nodes = [
        node["id"]
        for node in operation_nodes
        if node["id"] not in all_targets
    ]

    # If we have a clear start node, use it; otherwise use first operation node
    start_node = start_nodes[0] if start_nodes else (
        operation_nodes[0]["id"] if operation_nodes else None
    )

    if not start_node:
        return []

    # Traverse the graph to build ordered sequence
    sequence = []
    visited = set()  # Prevent infinite loops
    current = start_node

    while current and current not in visited:
        visited.add(current)

        # Add to sequence if it's an operation node
        if current in node_id_to_label:
            sequence.append(node_id_to_label[current])

        # Move to next node
        current = graph.get(current)

    return sequence


def build_operation_map_from_process_map(
    doc,
    *,
    process_map_field: str = "operation_map",
    op_map_child_table: str = "table_operation_map",
    last_operation_field: str = "last_operation",
):
    """
    Generic version of _update_operation_map_and_last_operation.

    - Reads the Process Map name from doc.<process_map_field>
    - Writes rows into child table <op_map_child_table>
    - Sets doc.<last_operation_field> to the unique sink operation
      (only if exactly one sink is found)
    """
    process_map_name = getattr(doc, process_map_field, None)
    if not process_map_name:
        return

    # reset table
    doc.set(op_map_child_table, [])

    process_map = frappe.get_doc("Process Map", process_map_name)
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
        if isinstance(comps, str):
            comps = [comps]
        if not comps:
            comps = [None]
        norm_edges.append((s, t, comps, idx))

    # Fallback: if no usable edges, best-effort last_operation from raw edges
    if not norm_edges:
        if edges:
            last_target_id = edges[-1].get("target")
            setattr(doc, last_operation_field, node_id_to_label.get(last_target_id))
        return

    # gather all explicit component names including None bucket
    all_components = set()
    for _s, _t, comps, _i in norm_edges:
        for c in comps:
            all_components.add(c)

    global_sinks = set()

    for comp in sorted(all_components, key=lambda x: ("" if x is None else str(x)).lower()):
        adj = defaultdict(list)        # op -> list[(next_op, edge_idx)]
        indeg = defaultdict(int)
        outdeg = defaultdict(int)
        ops_present = set()

        # collect nodes & edges for this component
        for s, t, comps, edge_idx in norm_edges:
            if comp not in comps:
                continue
            ops_present.add(s)
            ops_present.add(t)
            adj[s].append((t, edge_idx))
            indeg[t] += 1
            indeg.setdefault(s, indeg.get(s, 0))
            outdeg[s] += 1
            outdeg.setdefault(t, outdeg.get(t, 0))

        if not ops_present:
            continue

        # stabilize adjacency lists
        first_edge_index = {}
        for s, lst in adj.items():
            lst.sort(key=lambda it: it[1])
            if lst:
                first_edge_index[s] = min(idx for _, idx in lst)
        for op in ops_present:
            first_edge_index.setdefault(op, 10**9)

        # Kahn topo sort with stable ordering
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
            q = deque(sorted(list(q), key=lambda op: (first_edge_index.get(op, 10**9), str(op).lower())))

        if len(topo) < len(ops_present):
            topo = sorted(list(ops_present), key=lambda op: str(op).lower())

        # build a quick edge lookup for this component
        has_edge = set()
        for s, t, comps, _ei in norm_edges:
            if comp in comps:
                has_edge.add((s, t))

        seq_no = 0
        topo_index = {op: i for i, op in enumerate(topo)}
        edge_rows = []
        for s, t in sorted(has_edge, key=lambda st: (topo_index.get(st[0], 10**9),
                                                     topo_index.get(st[1], 10**9))):
            seq_no += 1
            edge_rows.append((s, t, seq_no))

        # append to child table
        for s, t, seq in edge_rows:
            row = doc.append(op_map_child_table, {})
            row.operation = s
            row.component = comp or ""
            row.next_operation = t
            row.sequence_no = seq
            row.configs = {}

        # sinks for this component
        sinks = [op for op in ops_present if outdeg.get(op, 0) == 0]
        for sk in sinks:
            global_sinks.add(sk)

    # Only set last_operation if there's a unique sink
    if len(global_sinks) == 1:
        setattr(doc, last_operation_field, next(iter(global_sinks)))


def populate_physical_cell_first_and_last_operations(
    doc,
    *,
    op_map_child_table: str = "table_operation_map",
    dest_child_table: str = "table_physical_cell_first_and_last_operation",
    physical_cell_field: str = "physical_cell",
    first_op_field: str = "first_operation",
    last_op_field: str = "last_operation",
):
    """
    Generic version of _populate_physical_cell_first_and_last_operations.

    - Reads operation map rows from <op_map_child_table>
    - Builds an ordering for operations based on sequence_no,
      including tail ops that appear only as next_operation.
    - For every Physical Cell (except Activation cell), finds operations
      present in op map and writes:
        <physical_cell_field>, <first_op_field>, <last_op_field>
      into <dest_child_table>.
    """
    # Clear destination table
    doc.set(dest_child_table, [])

    # --- 1) Build op -> order (including tail operations) ---

    op_to_seq = {}
    ops = set()
    next_ops = set()
    max_seq = 0

    for row in getattr(doc, op_map_child_table, []):
        op = getattr(row, "operation", None)
        nxt = getattr(row, "next_operation", None)
        seq = cint(getattr(row, "sequence_no", 0) or 0)

        if op:
            ops.add(op)
            op_to_seq[op] = seq
            if seq > max_seq:
                max_seq = seq

        if nxt:
            next_ops.add(nxt)

    # Tail ops = operations that appear only as next_operation (never as operation)
    tail_ops = {op for op in next_ops if op not in ops}

    # Assign virtual sequence numbers to tail ops after all defined ones
    for op in tail_ops:
        max_seq += 1
        op_to_seq[op] = max_seq

    if not op_to_seq:
        return

    # --- 2) All active cells except Activation cell ---

    physical_cells = frappe.get_all(
        "Physical Cell",
        filters={"name": ["!=", "QR/Barcode Cut Bundle Activation"]},
        pluck="name",
    )

    # --- 3) For each cell, compute first & last operation based on op_to_seq ---

    for cell_name in physical_cells:
        cell_operations = frappe.get_all(
            "Physical Cell Operation",
            filters={"parent": cell_name},
            pluck="operation",
        )

        # Keep only operations that we know in op_to_seq
        valid_ops = [op for op in cell_operations if op in op_to_seq]
        if not valid_ops:
            continue

        sorted_ops = sorted(valid_ops, key=lambda op: op_to_seq[op])
        first_op = sorted_ops[0]
        last_op = sorted_ops[-1]

        row = doc.append(dest_child_table, {})
        setattr(row, physical_cell_field, cell_name)
        setattr(row, first_op_field, first_op)
        setattr(row, last_op_field, last_op)
