// src/shared/graph-types.ts
//
// Canonical graph types used by GET /api/graph (the domain-aware full graph
// with derived edge types: subdomain, domain, tag, similarity). A simpler
// `LocalGraphNode`/`LocalGraphEdge` pair lives in `./types` and is used by
// GET /api/graph/*path (local subgraph via the indexer's graph_nodes/edges
// tables).
import type { Tag } from "./types";

export type GraphEdgeType = "subdomain" | "domain" | "tag" | "similarity";

export interface GraphNode {
  id: string;
  path: string;
  title: string;
  domain: string | null;
  subdomain: string | null;
  tags: Tag[];
  connectionCount: number;
  /** ingest-v3: project-first layout metadata. Nullable for legacy rows. */
  project: string | null;
  doc_type: string | null;
  thread: string | null;
}

export interface GraphEdge {
  source: string;
  target: string;
  type: GraphEdgeType;
  weight: number;
}

export interface GraphResponse {
  nodes: GraphNode[];
  edges: GraphEdge[];
}
