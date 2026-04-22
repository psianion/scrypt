// src/server/mcp/tools/remove-edge.ts
import type { ToolDef } from "../types";
import { TIER_VALUES, isTier } from "../confidence";
import { McpError, MCP_ERROR } from "../errors";
import type { Tier } from "../../../shared/types";
import type { Database } from "bun:sqlite";
import { refreshNoteFts } from "../../indexer/fts-refresh";

function endpointNotePath(db: Database, id: string): string | null {
  const n = db
    .query<{ note_path: string | null }, [string]>(
      `SELECT note_path FROM graph_nodes WHERE id = ?`,
    )
    .get(id);
  if (n) return n.note_path ?? null;
  const s = db
    .query<{ note_path: string | null }, [string]>(
      `SELECT note_path FROM note_sections WHERE id = ?`,
    )
    .get(id);
  return s?.note_path ?? null;
}

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
        const sourcePath = endpointNotePath(ctx.db, input.source);
        const targetPath = endpointNotePath(ctx.db, input.target);
        let removed: number;
        if (input.tier) {
          const res = ctx.db
            .query(
              `DELETE FROM graph_edges
               WHERE source = ? AND target = ? AND client_tag IS NOT NULL AND tier = ?`,
            )
            .run(input.source, input.target, input.tier);
          removed = res.changes;
        } else {
          const res = ctx.db
            .query(
              `DELETE FROM graph_edges
               WHERE source = ? AND target = ? AND client_tag IS NOT NULL`,
            )
            .run(input.source, input.target);
          removed = res.changes;
        }
        if (sourcePath) refreshNoteFts(ctx.db, sourcePath);
        if (targetPath && targetPath !== sourcePath) {
          refreshNoteFts(ctx.db, targetPath);
        }
        ctx.scheduleGraphRebuild();
        return { removed };
      },
    );
  },
};
