// src/server/mcp/idempotency.ts
//
// mcp_dedup-backed idempotency for MCP write tools. Every write tool
// accepts a caller-supplied `client_tag`; the first call executes and
// caches its response, later calls with the same tag return the cached
// response verbatim. Reusing a tag with a different tool is a caller
// bug and surfaces as MCP_ERROR.IDEMPOTENCY_MISMATCH.
import type { Database } from "bun:sqlite";
import { McpError, MCP_ERROR } from "./errors";

export class Idempotency {
  constructor(private db: Database) {}

  async runCached<T>(
    tool: string,
    clientTag: string,
    exec: () => Promise<T>,
  ): Promise<T> {
    const existing = this.db
      .query<{ tool: string; response: string }, [string]>(
        `SELECT tool, response FROM mcp_dedup WHERE client_tag = ?`,
      )
      .get(clientTag);

    if (existing) {
      if (existing.tool !== tool) {
        throw new McpError(
          MCP_ERROR.IDEMPOTENCY_MISMATCH,
          `client_tag ${clientTag} already used for tool ${existing.tool}`,
          { existing_tool: existing.tool, attempted_tool: tool },
        );
      }
      return JSON.parse(existing.response) as T;
    }

    const result = await exec();
    this.db
      .query(
        `INSERT INTO mcp_dedup (client_tag, tool, response, created_at) VALUES (?, ?, ?, ?)`,
      )
      .run(clientTag, tool, JSON.stringify(result), Date.now());
    return result;
  }

  sweepExpired(maxAgeMs: number): number {
    const cutoff = Date.now() - maxAgeMs;
    const res = this.db
      .query(`DELETE FROM mcp_dedup WHERE created_at < ?`)
      .run(cutoff);
    return res.changes;
  }
}
