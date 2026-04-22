import type { GraphSnapshot, SnapshotEdge, SnapshotNode } from "../../server/graph/snapshot";

export interface SearchIndex {
  titles: { id: string; lc: string }[];
  adjacency: Map<string, Set<string>>;
}

export interface FilteredNode extends SnapshotNode {
  isMatch: boolean;
}

export interface FilteredGraph {
  nodes: FilteredNode[];
  edges: SnapshotEdge[];
}

export function buildSearchIndex(snap: GraphSnapshot): SearchIndex {
  const titles = snap.nodes.map((n) => ({ id: n.id, lc: n.title.toLowerCase() }));
  const adjacency = new Map<string, Set<string>>();
  for (const e of snap.edges) {
    if (!adjacency.has(e.source)) adjacency.set(e.source, new Set());
    if (!adjacency.has(e.target)) adjacency.set(e.target, new Set());
    adjacency.get(e.source)!.add(e.target);
    adjacency.get(e.target)!.add(e.source);
  }
  return { titles, adjacency };
}

export function filterGraph(
  snap: GraphSnapshot,
  idx: SearchIndex,
  query: string,
): FilteredGraph {
  const q = query.trim().toLowerCase();
  if (q === "") {
    return {
      nodes: snap.nodes.map((n) => ({ ...n, isMatch: false })),
      edges: snap.edges,
    };
  }

  const matches = new Set(idx.titles.filter((t) => t.lc.includes(q)).map((t) => t.id));
  if (matches.size === 0) return { nodes: [], edges: [] };

  const keep = new Set<string>(matches);
  for (const m of matches) {
    for (const n of idx.adjacency.get(m) ?? []) keep.add(n);
  }

  const nodes: FilteredNode[] = snap.nodes
    .filter((n) => keep.has(n.id))
    .map((n) => ({ ...n, isMatch: matches.has(n.id) }));
  const edges = snap.edges.filter((e) => keep.has(e.source) && keep.has(e.target));
  return { nodes, edges };
}
