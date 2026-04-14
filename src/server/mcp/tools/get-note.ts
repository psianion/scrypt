// src/server/mcp/tools/get-note.ts
import { readFileSync, existsSync } from "node:fs";
import { resolve, relative, isAbsolute } from "node:path";
import matter from "gray-matter";
import { McpError, MCP_ERROR } from "../errors";
import type { ToolDef } from "../types";

interface Input {
  path: string;
}

interface EdgeRow {
  source: string;
  target: string;
  relation: string;
  confidence: string | null;
  reason: string | null;
}

interface Output {
  path: string;
  frontmatter: Record<string, unknown>;
  body: string;
  sections: ReturnType<
    import("../../indexer/sections-repo").SectionsRepo["listByNote"]
  >;
  metadata: ReturnType<
    import("../../indexer/metadata-repo").MetadataRepo["get"]
  >;
  outgoing_edges: EdgeRow[];
  incoming_edges: EdgeRow[];
}

export const getNoteTool: ToolDef<Input, Output> = {
  name: "get_note",
  description:
    "Read a note by vault-relative path. Returns content, frontmatter, sections, metadata, edges.",
  inputSchema: {
    type: "object",
    properties: { path: { type: "string" } },
    required: ["path"],
  },
  async handler(ctx, input) {
    if (isAbsolute(input.path)) {
      throw new McpError(
        MCP_ERROR.INVALID_PARAMS,
        "path must be vault-relative",
      );
    }
    const vaultAbs = resolve(ctx.vaultDir);
    const abs = resolve(vaultAbs, input.path);
    const rel = relative(vaultAbs, abs);
    if (rel.startsWith("..") || isAbsolute(rel)) {
      throw new McpError(MCP_ERROR.INVALID_PARAMS, "path escapes vault");
    }
    if (!existsSync(abs)) {
      throw new McpError(
        MCP_ERROR.NOT_FOUND,
        `note not found: ${input.path}`,
      );
    }
    const raw = readFileSync(abs, "utf8");
    const parsed = matter(raw);
    const sections = ctx.sections.listByNote(input.path);
    const metadata = ctx.metadata.get(input.path);
    const outgoing = ctx.db
      .query<EdgeRow, [string]>(
        `SELECT source, target, relation, confidence, reason
         FROM graph_edges WHERE source = ?`,
      )
      .all(input.path);
    const incoming = ctx.db
      .query<EdgeRow, [string]>(
        `SELECT source, target, relation, confidence, reason
         FROM graph_edges WHERE target = ?`,
      )
      .all(input.path);
    return {
      path: input.path,
      frontmatter: parsed.data,
      body: parsed.content,
      sections,
      metadata,
      outgoing_edges: outgoing,
      incoming_edges: incoming,
    };
  },
};
