// src/server/mcp/tools/remove-edge.ts
import { McpError, MCP_ERROR } from "../errors";
import type { ToolDef } from "../types";

const RESERVED = ["wikilink", "subdomain", "domain", "tag"];

interface Input {
  source: string;
  target: string;
  relation?: string;
  client_tag: string;
}

interface Output {
  removed: number;
}

export const removeEdgeTool: ToolDef<Input, Output> = {
  name: "remove_edge",
  description:
    "Removes semantic edges between two nodes. Structural edges are never touched.",
  inputSchema: {
    type: "object",
    properties: {
      source: { type: "string" },
      target: { type: "string" },
      relation: { type: "string" },
      client_tag: { type: "string" },
    },
    required: ["source", "target", "client_tag"],
  },
  async handler(ctx, input) {
    return ctx.idempotency.runCached(
      "remove_edge",
      input.client_tag,
      async () => {
        if (input.relation && RESERVED.includes(input.relation)) {
          throw new McpError(
            MCP_ERROR.CONFLICT,
            "cannot remove structural edges",
          );
        }
        const nonReserved = `relation NOT IN ('wikilink','subdomain','domain','tag')`;
        if (input.relation) {
          const res = ctx.db
            .query(
              `DELETE FROM graph_edges
               WHERE source = ? AND target = ? AND ${nonReserved} AND relation = ?`,
            )
            .run(input.source, input.target, input.relation);
          return { removed: res.changes };
        }
        const res = ctx.db
          .query(
            `DELETE FROM graph_edges
             WHERE source = ? AND target = ? AND ${nonReserved}`,
          )
          .run(input.source, input.target);
        return { removed: res.changes };
      },
    );
  },
};
