// src/server/mcp/tools/walk-graph.ts
import type { ToolDef } from "../types";
import { TIER_RANK, TIER_VALUES } from "../confidence";
import type { Tier } from "../../../shared/types";

const MAX_NODES = 500;

interface Input {
  from: string;
  depth?: number;
  tier_min?: Tier;
}

interface EdgeRow {
  source: string;
  target: string;
  tier: string;
}

interface NodeRow {
  id: string;
  label: string | null;
  note_path: string | null;
  community_id: number | null;
}

interface Output {
  nodes: NodeRow[];
  edges: EdgeRow[];
}

export const walkGraphTool: ToolDef<Input, Output> = {
  name: "walk_graph",
  description:
    "BFS traversal from a starting node. Caps at 500 nodes. Filters by tier.",
  inputSchema: {
    type: "object",
    properties: {
      from: { type: "string" },
      depth: { type: "number" },
      tier_min: {
        type: "string",
        enum: [...TIER_VALUES],
      },
    },
    required: ["from"],
  },
  async handler(ctx, input) {
    const depth = input.depth ?? 1;
    const minRank = TIER_RANK[input.tier_min ?? "semantically_related"];

    const visited = new Set<string>([input.from]);
    const seenEdges = new Set<string>();
    const edges: EdgeRow[] = [];
    let frontier = [input.from];

    const neighborStmt = ctx.db.prepare(
      `SELECT source, target, tier
       FROM graph_edges WHERE source = ? OR target = ?`,
    );

    for (
      let d = 0;
      d < depth && frontier.length > 0 && visited.size < MAX_NODES;
      d++
    ) {
      const next: string[] = [];
      for (const node of frontier) {
        const neighbors = neighborStmt.all(node, node) as EdgeRow[];
        for (const e of neighbors) {
          const rank = TIER_RANK[e.tier as Tier] ?? -1;
          if (rank < minRank) continue;
          const key = `${e.source}\u0000${e.target}\u0000${e.tier}`;
          if (seenEdges.has(key)) continue;
          seenEdges.add(key);
          edges.push(e);
          const other = e.source === node ? e.target : e.source;
          if (!visited.has(other) && visited.size < MAX_NODES) {
            visited.add(other);
            next.push(other);
          }
        }
      }
      frontier = next;
    }

    const ids = Array.from(visited);
    if (ids.length === 0) return { nodes: [], edges };
    const placeholders = ids.map(() => "?").join(",");
    const nodes = ctx.db
      .query<NodeRow, string[]>(
        `SELECT id, label, note_path, community_id FROM graph_nodes WHERE id IN (${placeholders})`,
      )
      .all(...ids);
    return { nodes, edges };
  },
};
