// src/server/mcp/tools/create-note.ts
//
// The central write tool. Writes the markdown file, runs the structural
// parse, upserts sections and the graph_nodes row, runs the embedding
// pipeline, and returns a structural result the caller uses to drive
// follow-up tool calls.
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve, relative, isAbsolute } from "node:path";
import { McpError, MCP_ERROR } from "../errors";
import { parseStructural } from "../../indexer/structural-parse";
import type { ToolDef } from "../types";
import type { Database } from "bun:sqlite";

// graph-v2 (G2): wikilink edge production removed. The body is no longer
// scanned for [[…]]; all connections come from add_edge (LLM-curated) or
// rescan_similarity (semantic). `edges_created` stays in the response for
// backward compat with callers but is always 0.

interface Input {
  path: string;
  content: string;
  client_tag: string;
}

interface Output {
  note_path: string;
  node_id: string;
  sections: { id: string; heading_text: string; level: number }[];
  edges_created: number;
  chunks_embedded: number;
  chunks_total: number;
  embed_ms: number;
  embedded: boolean;
}

function assertInsideVault(vaultDir: string, relPath: string): string {
  if (isAbsolute(relPath)) {
    throw new McpError(
      MCP_ERROR.INVALID_PARAMS,
      "path must be vault-relative",
    );
  }
  if (!relPath.endsWith(".md")) {
    throw new McpError(MCP_ERROR.INVALID_PARAMS, "path must end in .md");
  }
  const vaultAbs = resolve(vaultDir);
  const abs = resolve(vaultAbs, relPath);
  const rel = relative(vaultAbs, abs);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new McpError(MCP_ERROR.INVALID_PARAMS, "path escapes vault");
  }
  return abs;
}

function upsertNode(
  db: Database,
  notePath: string,
  title: string,
  contentHash: string,
): void {
  db.query(
    `INSERT INTO graph_nodes (id, kind, label, note_path, content_hash)
       VALUES (?, 'note', ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       label = excluded.label,
       content_hash = excluded.content_hash`,
  ).run(notePath, title, notePath, contentHash);
}

export const createNoteTool: ToolDef<Input, Output> = {
  name: "create_note",
  description:
    "Create or replace a markdown note. Runs structural parse, embeds the content, returns sections and embed status.",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string" },
      content: { type: "string" },
      client_tag: { type: "string" },
    },
    required: ["path", "content", "client_tag"],
  },
  async handler(ctx, input, correlationId) {
    return ctx.idempotency.runCached(
      "create_note",
      input.client_tag,
      async () => {
        const abs = assertInsideVault(ctx.vaultDir, input.path);

        mkdirSync(dirname(abs), { recursive: true });
        writeFileSync(abs, input.content, "utf8");

        const parsed = parseStructural(input.path, input.content);

        ctx.sections.replaceNoteSections(
          input.path,
          parsed.sections.map((s) => ({
            id: s.id,
            headingSlug: s.headingSlug,
            headingText: s.headingText,
            level: s.level,
            startLine: s.startLine,
            endLine: s.endLine,
          })),
        );

        upsertNode(ctx.db, input.path, parsed.title, parsed.contentHash);

        const embed = await ctx.embedService.embedNote(parsed, correlationId);

        // Delegate to the legacy indexer if one is wired in. Docker's
        // fsevents propagation through bind mounts is unreliable on
        // macOS, so relying on the file watcher alone leaves the
        // `notes` / `notes_fts` / tags / backlinks / tasks tables out of
        // sync after an MCP write. Calling reindexNote directly makes
        // the update synchronous and reliable. The embedding pipeline
        // that runs inside reindexNote coalesces on (path, content_hash)
        // against the call we just made, so it's a fast-path no-op.
        if (ctx.legacyIndexer) {
          try {
            await ctx.legacyIndexer.reindexNote(input.path);
          } catch (err) {
            console.error(
              `[create_note] legacyIndexer.reindexNote(${input.path}) failed:`,
              err,
            );
          }
        }

        const result: Output = {
          note_path: input.path,
          node_id: input.path,
          sections: parsed.sections.map((s) => ({
            id: s.id,
            heading_text: s.headingText,
            level: s.level,
          })),
          edges_created: 0,
          chunks_embedded: embed.chunks_embedded,
          chunks_total: embed.chunks_total,
          embed_ms: embed.embed_ms,
          embedded: embed.chunks_embedded === embed.chunks_total,
        };
        ctx.scheduleGraphRebuild();
        return result;
      },
    );
  },
};
