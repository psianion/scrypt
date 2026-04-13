// src/shared/graph-types.ts
import type { Tag } from "./types";

export type GraphEdgeType = "wikilink" | "subdomain" | "domain" | "tag";

export interface GraphNodeV2 {
  id: number;
  path: string;
  title: string;
  domain: string | null;
  subdomain: string | null;
  tags: Tag[];
  connectionCount: number;
}

export interface GraphEdgeV2 {
  source: number;
  target: number;
  type: GraphEdgeType;
  weight: number;
}

export interface GraphResponse {
  nodes: GraphNodeV2[];
  edges: GraphEdgeV2[];
}
