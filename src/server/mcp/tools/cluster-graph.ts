// src/server/mcp/tools/cluster-graph.ts
import { runLouvain, type LouvainResult } from "../../indexer/clustering";
import type { ToolDef } from "../types";

interface Input {
  algorithm?: "louvain";
}

export const clusterGraphTool: ToolDef<Input, LouvainResult> = {
  name: "cluster_graph",
  description:
    "Runs Louvain community detection and writes community_id to graph_nodes.",
  inputSchema: {
    type: "object",
    properties: { algorithm: { type: "string", enum: ["louvain"] } },
  },
  async handler(ctx) {
    return runLouvain(ctx.db);
  },
};
