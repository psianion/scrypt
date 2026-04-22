// src/server/mcp/tools/batch-ingest.ts
//
// Bulk-ingest .md files from an external directory into the vault.
// For each file: strips any existing frontmatter, rewrites it with the
// project-first ingest-v3 shape (project + doc_type + slug + ingest block),
// writes to projects/<project>/<doc_type>/<slug>.md, parses structure,
// embeds content, denormalizes project/doc_type on the notes row, then
// computes similarity edges between all new + existing notes.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { writeFileSync, mkdirSync } from "node:fs";
import {
  join,
  relative,
  resolve,
  dirname,
  basename,
  isAbsolute,
} from "node:path";
import { createHash } from "node:crypto";
import { parseStructural } from "../../indexer/structural-parse";
import type { ToolDef } from "../types";
import type { Database } from "bun:sqlite";
import {
  findSimilarPairs,
  upsertSemanticEdges,
  getSimilarityThreshold,
} from "../../graph/semantic-similarity";
import { DOC_TYPES, isDocType, type DocType } from "../../vocab/doc-types";
import { buildVaultPath } from "../../path/vault-path";
import { parseFrontmatter, stringifyFrontmatter } from "../../parsers";
import { INGEST_VERSION } from "../../ingest/ingest-block";

interface Input {
  source_dir: string;
  /** ingest-v3: target project slug (required). `domain` is an alias for transition. */
  project?: string;
  /** ingest-v3 alias for `project`. Deprecated — prefer `project`. */
  domain?: string;
  /** ingest-v3: doc_type bucket under the project. Defaults to "research". */
  doc_type?: DocType;
  batch_size?: number;
  min_similarity?: number;
  client_tag: string;
}

interface FileResult {
  source: string;
  vault_path: string;
  status: "ok" | "skip" | "error";
  chunks?: number;
  error?: string;
}

interface Output {
  scanned: number;
  ingested: number;
  skipped: number;
  errored: number;
  total_chunks: number;
  similarity_edges_created: number;
  files: FileResult[];
}

function walkMarkdown(dir: string, base = dir): string[] {
  const acc: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith(".")) continue;
    if (entry === "node_modules") continue;
    const abs = join(dir, entry);
    let st;
    try {
      st = statSync(abs);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      acc.push(...walkMarkdown(abs, base));
    } else if (entry.endsWith(".md")) {
      acc.push(relative(base, abs));
    }
  }
  return acc;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/\.md$/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function extractTitle(fm: Record<string, unknown>, body: string, filename: string): string {
  const fmTitle = fm.title;
  if (typeof fmTitle === "string" && fmTitle.trim()) return fmTitle.trim();
  const h1 = body.match(/^#\s+(.+)$/m);
  if (h1) return h1[1].trim();
  return basename(filename, ".md");
}

function clientTag(rootTag: string, relPath: string): string {
  const hash = createHash("sha256")
    .update(`${rootTag}|${relPath}`)
    .digest("hex")
    .slice(0, 12);
  return `batch-ingest:${rootTag}:${hash}`;
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

function allEmbeddedPaths(db: Database, model: string): string[] {
  return (
    db
      .query<{ note_path: string }, [string]>(
        `SELECT DISTINCT note_path FROM note_chunk_embeddings WHERE model = ?`,
      )
      .all(model)
  ).map((r) => r.note_path);
}

export const batchIngestTool: ToolDef<Input, Output> = {
  name: "batch_ingest",
  description:
    "Bulk-ingest .md files into projects/<project>/<doc_type>/<slug>.md. Writes each file with a project-first ingest-v3 frontmatter block, embeds content, then creates similarity edges between notes.",
  inputSchema: {
    type: "object",
    properties: {
      source_dir: {
        type: "string",
        description: "Absolute path to directory containing .md files",
      },
      project: {
        type: "string",
        description:
          "Target project slug (required). The vault layout puts every file under projects/<project>/<doc_type>/<slug>.md.",
      },
      domain: {
        type: "string",
        description:
          "Deprecated alias for `project` — kept for the ingest-v2 → v3 transition.",
      },
      doc_type: {
        type: "string",
        enum: [...DOC_TYPES],
        description: "doc_type bucket under the project (default: research).",
      },
      batch_size: { type: "number", description: "Files per yield (default: 25)" },
      min_similarity: {
        type: "number",
        description:
          "Cosine threshold for semantically_related edges. Default: SCRYPT_SIMILARITY_THRESHOLD env (0.78 if unset).",
      },
      client_tag: {
        type: "string",
        description:
          "Top-level idempotency tag for the whole batch; each file derives its own tag from this + its source path.",
      },
    },
    required: ["source_dir", "client_tag"],
  },

  async handler(ctx, input, correlationId) {
    const sourceDir = input.source_dir;
    if (!isAbsolute(sourceDir)) {
      throw new Error("source_dir must be an absolute path");
    }

    const project = input.project ?? input.domain;
    if (!project || typeof project !== "string" || project.length === 0) {
      throw new Error(
        "project is required (use 'project' — 'domain' is a transitional alias)",
      );
    }
    const docType: DocType = isDocType(input.doc_type)
      ? input.doc_type
      : "research";
    const batchSize = input.batch_size ?? 25;
    const minSim = input.min_similarity ?? getSimilarityThreshold();
    const model =
      process.env.SCRYPT_EMBED_MODEL ?? "Xenova/bge-small-en-v1.5";

    const mdFiles = walkMarkdown(sourceDir);
    const results: FileResult[] = [];
    const newPaths = new Set<string>();
    let totalChunks = 0;
    let ingested = 0;
    let skipped = 0;
    let errored = 0;

    for (let i = 0; i < mdFiles.length; i++) {
      const relPath = mdFiles[i];
      const absSource = join(sourceDir, relPath);
      const tag = clientTag(input.client_tag, relPath);
      const titleSlug = slugify(relPath);
      const vaultPath = buildVaultPath(project, docType, titleSlug);

      try {
        const result = await ctx.idempotency.runCached(
          "batch_ingest",
          tag,
          async () => {
            const rawBytes = readFileSync(absSource);
            const rawText = rawBytes.toString("utf8");
            const { frontmatter: rawFm, body } = parseFrontmatter(rawText);

            const hash =
              "sha256:" + createHash("sha256").update(rawBytes).digest("hex");
            const stat = statSync(absSource);
            const ingest = {
              original_filename: basename(relPath),
              original_path: absSource,
              source_hash: hash,
              source_size: rawBytes.length,
              source_mtime: new Date(stat.mtimeMs).toISOString(),
              tokens: null,
              cost_usd: null,
              model: null,
              ingested_at: new Date().toISOString(),
              ingest_version: INGEST_VERSION,
            };

            const title = extractTitle(rawFm, body, relPath);
            const fm: Record<string, unknown> = {
              ...rawFm,
              title,
              slug: titleSlug,
              project,
              doc_type: docType,
              tags: Array.isArray(rawFm.tags) ? rawFm.tags : [],
              ingest,
            };

            const content = stringifyFrontmatter(fm, body);

            const abs = resolve(ctx.vaultDir, vaultPath);
            mkdirSync(dirname(abs), { recursive: true });
            writeFileSync(abs, content, "utf8");

            const parsed = parseStructural(vaultPath, content);

            ctx.sections.replaceNoteSections(
              vaultPath,
              parsed.sections.map((s) => ({
                id: s.id,
                headingSlug: s.headingSlug,
                headingText: s.headingText,
                level: s.level,
                startLine: s.startLine,
                endLine: s.endLine,
              })),
            );

            upsertNode(ctx.db, vaultPath, title, parsed.contentHash);

            const embed = await ctx.embedService.embedNote(
              parsed,
              correlationId,
            );

            if (ctx.legacyIndexer) {
              try {
                await ctx.legacyIndexer.reindexNote(vaultPath);
              } catch {}
            }

            // ingest-v3: denormalize project / doc_type into notes (mirrors
            // create_note so batch-ingested rows carry the columns even when
            // no legacyIndexer is wired into the context).
            ctx.db
              .query(
                `INSERT INTO notes (path, title, project, doc_type, thread)
                 VALUES (?, ?, ?, ?, NULL)
                 ON CONFLICT(path) DO UPDATE SET
                   project  = excluded.project,
                   doc_type = excluded.doc_type`,
              )
              .run(vaultPath, title, project, docType);

            return {
              note_path: vaultPath,
              chunks_total: embed.chunks_total,
              was_cached: false,
            };
          },
        );

        if (result.was_cached === undefined) {
          // Returned from idempotency cache.
          results.push({
            source: relPath,
            vault_path: result.note_path,
            status: "skip",
          });
          skipped += 1;
        } else {
          newPaths.add(vaultPath);
          totalChunks += result.chunks_total;
          ingested += 1;
          results.push({
            source: relPath,
            vault_path: vaultPath,
            status: "ok",
            chunks: result.chunks_total,
          });
        }
      } catch (err) {
        errored += 1;
        results.push({
          source: relPath,
          vault_path: "",
          status: "error",
          error: (err as Error).message,
        });
      }

      // Yield to event loop between batches
      if ((i + 1) % batchSize === 0) {
        await new Promise((r) => setImmediate(r));
      }
    }

    // Compute semantically_related edges scoped to the newly-ingested notes
    // (so we don't re-score the entire vault every batch). At least one side
    // of every emitted pair will be a freshly-ingested note.
    let simEdges = 0;
    if (newPaths.size > 0) {
      const allPaths = allEmbeddedPaths(ctx.db, model);
      const pairs = findSimilarPairs(ctx.db, allPaths, model, {
        minSimilarity: minSim,
        scopedTo: newPaths,
      });
      simEdges = upsertSemanticEdges(ctx.db, pairs);
    }

    ctx.scheduleGraphRebuild();

    return {
      scanned: mdFiles.length,
      ingested,
      skipped,
      errored,
      total_chunks: totalChunks,
      similarity_edges_created: simEdges,
      files: results,
    };
  },
};
