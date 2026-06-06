// src/server/mcp/tools/create-note.ts
//
// The central write tool. Writes the markdown file, runs the structural
// parse, upserts sections and the graph_nodes row, runs the embedding
// pipeline, and returns a structural result the caller uses to drive
// follow-up tool calls.
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, resolve, relative, isAbsolute } from "node:path";
import { McpError, MCP_ERROR } from "../errors";
import { parseStructural } from "../../indexer/structural-parse";
import { refreshNoteFts } from "../../indexer/fts-refresh";
import { computeContentHash } from "../../sync/content-hash";
import { parseFrontmatter } from "../../parsers";
import { validateProjectPath } from "../../path/validate-project-path";
import type { ToolDef } from "../types";
import type { Database } from "bun:sqlite";

// graph-v2 (G2): wikilink edge production removed. The body is no longer
// scanned for [[…]]; all connections come from add_edge (LLM-curated) or
// rescan_similarity (semantic). `edges_created` stays in the response for
// backward compat with callers but is always 0.

// F13: cap accepted note content so an accidentally-huge .md (a renamed
// binary, a pasted blob) can't OOM the process or the hub during sync.
// Mirrors MAX_NOTE_BYTES on the /api/sync/note read path so the write and
// read ceilings agree.
const MAX_NOTE_BYTES = 25 * 1024 * 1024; // 25 MiB

interface Input {
  path: string;
  content: string;
  client_tag: string;
  /**
   * Escape hatch — skip the projects/<project>/<doc_type>/<slug>.md layout
   * check. Used for internal callers (tests, plugin authors) that write to
   * non-standard paths like `_inbox/stashed.md`. Defaults to false.
   */
  allow_nonstandard_path?: boolean;
  /**
   * F12 (opt-in additive guard): when set, the hub overwrites the note only
   * if the current on-disk content's engine hash equals this value. A
   * mismatch means the note diverged since the caller last read it, so the
   * write is rejected with CONFLICT instead of blindly overwriting — letting
   * a pusher convert a genuine divergence into a server-detected clash.
   * Use "" to assert the note must NOT already exist (additive create). When
   * omitted, behaviour is unchanged: create-or-replace.
   */
  expected_prev_hash?: string;
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
      allow_nonstandard_path: { type: "boolean" },
      expected_prev_hash: { type: "string" },
    },
    required: ["path", "content", "client_tag"],
  },
  async handler(ctx, input, correlationId) {
    return ctx.idempotency.runCached(
      "create_note",
      input.client_tag,
      async () => {
        const abs = assertInsideVault(ctx.vaultDir, input.path);

        // F13: reject oversized content before we parse, embed, or write it.
        // Measure UTF-8 bytes (not string length) to match the byte-based
        // ceiling used by the /api/sync/note read path.
        const contentBytes = Buffer.byteLength(input.content, "utf8");
        if (contentBytes > MAX_NOTE_BYTES) {
          throw new McpError(
            MCP_ERROR.INVALID_PARAMS,
            `note content exceeds the ${MAX_NOTE_BYTES}-byte limit`,
            { code: "note_too_large", bytes: contentBytes },
          );
        }

        // F12 (opt-in additive guard): if the caller pinned an expected hash,
        // refuse to overwrite a note that has since diverged. "" asserts the
        // note must not already exist (a pure additive create). The default
        // (param omitted) keeps the historical create-or-replace contract so
        // existing callers — including the in-app resolveClash write — are
        // unaffected.
        if (input.expected_prev_hash !== undefined) {
          const exists = existsSync(abs);
          let currentHash = "";
          if (exists) {
            const onDisk = readFileSync(abs, "utf8");
            const { frontmatter: curFm, body: curBody } =
              parseFrontmatter(onDisk);
            currentHash = computeContentHash(curFm, curBody);
          }
          if (currentHash !== input.expected_prev_hash) {
            throw new McpError(
              MCP_ERROR.CONFLICT,
              exists
                ? "note diverged since last read; overwrite rejected"
                : "note does not exist; cannot match expected_prev_hash",
              {
                code: "hash_mismatch",
                expected: input.expected_prev_hash,
                actual: currentHash,
              },
            );
          }
        }

        // ingest-v3: enforce the projects/<project>/<doc_type>/<slug>.md
        // layout unless the caller explicitly opts out. Parse the content's
        // frontmatter first so we can cross-check path vs frontmatter.
        const { frontmatter } = parseFrontmatter(input.content);
        const allowNonstandard = input.allow_nonstandard_path === true;
        const v = validateProjectPath(input.path, frontmatter, {
          allowNonstandardPath: allowNonstandard,
        });
        if (!v.ok) {
          throw new McpError(
            MCP_ERROR.INVALID_PARAMS,
            v.message ?? "invalid path",
            { code: v.code },
          );
        }

        mkdirSync(dirname(abs), { recursive: true });
        writeFileSync(abs, input.content, "utf8");

        const parsed = parseStructural(input.path, input.content);

        // F3: graph_nodes.content_hash MUST match the engine's
        // computeContentHash so the hub manifest advertises a hash a puller
        // can reproduce. parsed.contentHash is sha256(body) (used as the
        // embed cache key) and is the WRONG value for graph_nodes — derive
        // the engine hash from the same parsed frontmatter/body here.
        const engineHash = computeContentHash(parsed.frontmatter, parsed.body);

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

        upsertNode(ctx.db, input.path, parsed.title, engineHash);

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
        refreshNoteFts(ctx.db, input.path);

        // ingest-v3: denormalize project / doc_type / thread into the notes
        // row. UPSERT so this is self-sufficient in tests that don't wire a
        // legacyIndexer; in prod the indexer writes the row first and this
        // statement only refreshes the three denormalized columns.
        const project =
          typeof frontmatter.project === "string" ? frontmatter.project : null;
        const docType =
          typeof frontmatter.doc_type === "string"
            ? frontmatter.doc_type
            : null;
        const thread =
          typeof frontmatter.thread === "string" ? frontmatter.thread : null;
        ctx.db
          .query(
            `INSERT INTO notes (path, title, project, doc_type, thread)
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(path) DO UPDATE SET
               project  = excluded.project,
               doc_type = excluded.doc_type,
               thread   = excluded.thread`,
          )
          .run(input.path, parsed.title, project, docType, thread);

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
