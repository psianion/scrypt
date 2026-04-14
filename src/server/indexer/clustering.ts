// src/server/indexer/clustering.ts
//
// Runs Louvain community detection over the Wave 8 TEXT-keyed graph
// and writes community_id back to graph_nodes.
import type { Database } from "bun:sqlite";
import Graph from "graphology";
// @ts-expect-error — graphology-communities-louvain has no bundled types
import louvain from "graphology-communities-louvain";

export interface LouvainResult {
  communities: number;
  modularity: number;
}

interface DetailedResult {
  communities: Record<string, number>;
  modularity?: number;
}

export function runLouvain(db: Database): LouvainResult {
  const graph = new Graph({ type: "undirected", multi: false });

  const nodes = db
    .query<{ id: string }, []>(`SELECT id FROM graph_nodes`)
    .all();
  for (const n of nodes) graph.addNode(n.id);

  const edges = db
    .query<{ source: string; target: string }, []>(
      `SELECT source, target FROM graph_edges`,
    )
    .all();
  for (const e of edges) {
    if (!graph.hasNode(e.source) || !graph.hasNode(e.target)) continue;
    if (e.source === e.target) continue;
    if (!graph.hasEdge(e.source, e.target)) {
      graph.addEdge(e.source, e.target);
    }
  }

  if (graph.order === 0) return { communities: 0, modularity: 0 };

  const details = louvain.detailed(graph) as DetailedResult;
  const communities = details.communities;

  const stmt = db.prepare(
    `UPDATE graph_nodes SET community_id = ? WHERE id = ?`,
  );
  const tx = db.transaction(() => {
    for (const [id, cid] of Object.entries(communities)) stmt.run(cid, id);
  });
  tx();

  const communityCount = new Set(Object.values(communities)).size;
  return {
    communities: communityCount,
    modularity: details.modularity ?? 0,
  };
}
