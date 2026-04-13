// src/shared/graph-types.ts
//
// Canonical graph types used by GET /api/graph (the domain-aware full graph
// with four edge types: wikilink, subdomain, domain, tag). A simpler
// `LocalGraphNode`/`LocalGraphEdge` pair lives in `./types` and is used by
// GET /api/graph/*path (local subgraph via the indexer's graph_nodes/edges
// tables).
import type { Tag } from "./types";

export type GraphEdgeType = "wikilink" | "subdomain" | "domain" | "tag";

export interface GraphNode {
  id: number;
  path: string;
  title: string;
  domain: string | null;
  subdomain: string | null;
  tags: Tag[];
  connectionCount: number;
}

export interface GraphEdge {
  source: number;
  target: number;
  type: GraphEdgeType;
  weight: number;
}

export interface GraphResponse {
  nodes: GraphNode[];
  edges: GraphEdge[];
}
