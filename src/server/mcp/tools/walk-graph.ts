// src/server/mcp/tools/walk-graph.ts
import type { ToolDef } from "../types";

const CONFIDENCE_RANK: Record<string, number> = {
  ambiguous: 0,
  inferred: 1,
  extracted: 2,
};

const MAX_NODES = 500;

interface Input {
  from: string;
  depth?: number;
  relation_filter?: string[];
  confidence_min?: "ambiguous" | "inferred" | "extracted";
}

interface EdgeRow {
  source: string;
  target: string;
  relation: string;
  confidence: string | null;
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
    "BFS traversal from a starting node. Caps at 500 nodes. Filters by relation and confidence.",
  inputSchema: {
    type: "object",
    properties: {
      from: { type: "string" },
      depth: { type: "number" },
      relation_filter: { type: "array" },
      confidence_min: {
        type: "string",
        enum: ["ambiguous", "inferred", "extracted"],
      },
    },
    required: ["from"],
  },
  async handler(ctx, input) {
    const depth = input.depth ?? 1;
    const minRank = CONFIDENCE_RANK[input.confidence_min ?? "ambiguous"];
    const relFilter =
      input.relation_filter && input.relation_filter.length > 0
        ? new Set(input.relation_filter)
        : null;

    const visited = new Set<string>([input.from]);
    const edges: EdgeRow[] = [];
    let frontier = [input.from];

    const neighborStmt = ctx.db.prepare(
      `SELECT source, target, relation, confidence
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
          if (relFilter && !relFilter.has(e.relation)) continue;
          const rank = CONFIDENCE_RANK[e.confidence ?? "extracted"] ?? 2;
          if (rank < minRank) continue;
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
