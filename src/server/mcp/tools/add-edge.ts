// src/server/mcp/tools/add-edge.ts
import { McpError, MCP_ERROR } from "../errors";
import type { ToolDef } from "../types";
import type { Database } from "bun:sqlite";
import { TIER_VALUES, isTier } from "../confidence";
import type { Tier } from "../../../shared/types";

interface Input {
  source: string;
  target: string;
  tier: Tier;
  reason?: string;
  client_tag: string;
}

interface Output {
  edge_id: number;
}

function endpointExists(db: Database, id: string): boolean {
  const n =
    db
      .query<{ n: number }, [string]>(
        `SELECT COUNT(*) AS n FROM graph_nodes WHERE id = ?`,
      )
      .get(id)?.n ?? 0;
  if (n > 0) return true;
  const s =
    db
      .query<{ n: number }, [string]>(
        `SELECT COUNT(*) AS n FROM note_sections WHERE id = ?`,
      )
      .get(id)?.n ?? 0;
  return s > 0;
}

export const addEdgeTool: ToolDef<Input, Output> = {
  name: "add_edge",
  description:
    "Adds a tiered edge between two existing nodes (note or section).",
  inputSchema: {
    type: "object",
    properties: {
      source: { type: "string" },
      target: { type: "string" },
      tier: {
        type: "string",
        enum: [...TIER_VALUES],
      },
      reason: { type: "string" },
      client_tag: { type: "string" },
    },
    required: ["source", "target", "tier", "client_tag"],
  },
  async handler(ctx, input) {
    return ctx.idempotency.runCached("add_edge", input.client_tag, async () => {
      if (!isTier(input.tier)) {
        throw new McpError(
          MCP_ERROR.INVALID_PARAMS,
          `invalid tier: ${String(input.tier)}. Allowed: ${TIER_VALUES.join(", ")}`,
        );
      }
      if (!endpointExists(ctx.db, input.source)) {
        throw new McpError(
          MCP_ERROR.NOT_FOUND,
          `source not found: ${input.source}`,
        );
      }
      if (!endpointExists(ctx.db, input.target)) {
        throw new McpError(
          MCP_ERROR.NOT_FOUND,
          `target not found: ${input.target}`,
        );
      }
      const res = ctx.db
        .query(
          `INSERT INTO graph_edges
             (source, target, tier, reason, client_tag, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.source,
          input.target,
          input.tier,
          input.reason ?? null,
          input.client_tag,
          Date.now(),
        );
      ctx.scheduleGraphRebuild();
      return { edge_id: Number(res.lastInsertRowid) };
    });
  },
};
