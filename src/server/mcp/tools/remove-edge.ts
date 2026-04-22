// src/server/mcp/tools/remove-edge.ts
import type { ToolDef } from "../types";
import { TIER_VALUES, isTier } from "../confidence";
import { McpError, MCP_ERROR } from "../errors";
import type { Tier } from "../../../shared/types";

interface Input {
  source: string;
  target: string;
  tier?: Tier;
  client_tag: string;
}

interface Output {
  removed: number;
}

export const removeEdgeTool: ToolDef<Input, Output> = {
  name: "remove_edge",
  description:
    "Removes user-added (MCP-tagged) edges between two nodes. Structural indexer edges (client_tag IS NULL) are never touched.",
  inputSchema: {
    type: "object",
    properties: {
      source: { type: "string" },
      target: { type: "string" },
      tier: { type: "string", enum: [...TIER_VALUES] },
      client_tag: { type: "string" },
    },
    required: ["source", "target", "client_tag"],
  },
  async handler(ctx, input) {
    return ctx.idempotency.runCached(
      "remove_edge",
      input.client_tag,
      async () => {
        if (input.tier !== undefined && !isTier(input.tier)) {
          throw new McpError(
            MCP_ERROR.INVALID_PARAMS,
            `invalid tier: ${String(input.tier)}. Allowed: ${TIER_VALUES.join(", ")}`,
          );
        }
        if (input.tier) {
          const res = ctx.db
            .query(
              `DELETE FROM graph_edges
               WHERE source = ? AND target = ? AND client_tag IS NOT NULL AND tier = ?`,
            )
            .run(input.source, input.target, input.tier);
          ctx.scheduleGraphRebuild();
          return { removed: res.changes };
        }
        const res = ctx.db
          .query(
            `DELETE FROM graph_edges
             WHERE source = ? AND target = ? AND client_tag IS NOT NULL`,
          )
          .run(input.source, input.target);
        ctx.scheduleGraphRebuild();
        return { removed: res.changes };
      },
    );
  },
};
