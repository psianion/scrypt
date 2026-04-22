// src/server/mcp/tools/add-edge.ts
import { McpError, MCP_ERROR } from "../errors";
import type { ToolDef } from "../types";
import type { Database } from "bun:sqlite";
import { TIER_VALUES, isTier } from "../confidence";
import type { Tier } from "../../../shared/types";
import { projectOf } from "../../graph/snapshot";
import { refreshNoteFts } from "../../indexer/fts-refresh";

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

function docTypeFor(db: Database, notePath: string | null): string | null {
  if (!notePath) return null;
  const r = db
    .query<{ doc_type: string | null }, [string]>(
      `SELECT doc_type FROM note_metadata WHERE note_path = ?`,
    )
    .get(notePath);
  return r?.doc_type ?? null;
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

      // Anti-connection rules — clean DB invariant. The snapshot enforces
      // these at render time too, but we reject here so no junk row is stored.
      const sourcePath = endpointNotePath(ctx.db, input.source);
      const targetPath = endpointNotePath(ctx.db, input.target);
      const sourceType = docTypeFor(ctx.db, sourcePath);
      const targetType = docTypeFor(ctx.db, targetPath);

      if (sourceType === "plan" && targetType === "plan") {
        throw new McpError(
          MCP_ERROR.INVALID_PARAMS,
          "plan\u2194plan edges are filtered; would never render",
        );
      }
      if (
        input.tier === "connected" &&
        (sourceType === "journal" ||
          sourceType === "changelog" ||
          targetType === "journal" ||
          targetType === "changelog")
      ) {
        throw new McpError(
          MCP_ERROR.INVALID_PARAMS,
          "journal/changelog edges cap at tier='mentions'; got 'connected'",
        );
      }
      if (
        input.tier === "semantically_related" &&
        sourcePath &&
        targetPath &&
        projectOf(sourcePath) !== projectOf(targetPath)
      ) {
        throw new McpError(
          MCP_ERROR.INVALID_PARAMS,
          "semantically_related edges must be within the same project",
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
      // Refresh FTS5 for both endpoints when they're notes — the new edge's
      // reason text needs to land in each endpoint's edge_reasons column.
      if (sourcePath) refreshNoteFts(ctx.db, sourcePath);
      if (targetPath && targetPath !== sourcePath) {
        refreshNoteFts(ctx.db, targetPath);
      }
      ctx.scheduleGraphRebuild();
      return { edge_id: Number(res.lastInsertRowid) };
    });
  },
};
