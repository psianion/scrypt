// src/server/mcp/tools/batch-ingest.ts
//
// Bulk-ingest .md files from an external directory into the vault.
// For each file: writes to vault, parses structure, embeds content,
// then computes similarity edges between all new + existing notes.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { writeFileSync, mkdirSync } from "node:fs";
import { join, relative, resolve, dirname, basename, isAbsolute } from "node:path";
import { createHash } from "node:crypto";
import { parseStructural } from "../../indexer/structural-parse";
import type { ToolDef, ToolContext } from "../types";
import type { Database } from "bun:sqlite";

interface Input {
  source_dir: string;
  domain?: string;
  target_prefix?: string;
  batch_size?: number;
  min_similarity?: number;
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

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/\.md$/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function extractTitle(content: string, filename: string): string {
  const h1 = content.match(/^#\s+(.+)$/m);
  if (h1) return h1[1].trim();
  const fmTitle = content.match(/^title:\s*(.+)$/m);
  if (fmTitle) return fmTitle[1].replace(/^["']|["']$/g, "").trim();
  return basename(filename, ".md");
}

function clientTag(sourceDir: string, relPath: string): string {
  const hash = createHash("sha256")
    .update(`${sourceDir}|${relPath}`)
    .digest("hex")
    .slice(0, 12);
  return `batch-ingest:${hash}`;
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

function upsertWikilinkEdges(
  db: Database,
  sourcePath: string,
  targets: string[],
): number {
  if (targets.length === 0) return 0;
  db.query(
    `DELETE FROM graph_edges WHERE source = ? AND relation = 'wikilink'`,
  ).run(sourcePath);
  const ensureNode = db.prepare(
    `INSERT OR IGNORE INTO graph_nodes (id, kind, note_path, label)
     VALUES (?, 'note', ?, ?)`,
  );
  const insert = db.prepare(
    `INSERT OR IGNORE INTO graph_edges
       (source, target, relation, weight, created_at)
     VALUES (?, ?, 'wikilink', 3, ?)`,
  );
  let count = 0;
  const now = Date.now();
  for (const t of targets) {
    ensureNode.run(t, t, t);
    const res = insert.run(sourcePath, t, now);
    if (res.changes > 0) count += 1;
  }
  return count;
}

function computeSimilarityEdges(
  db: Database,
  newPaths: Set<string>,
  model: string,
  threshold: number,
): number {
  const rows = db
    .query<
      { note_path: string; dims: number; vector: Uint8Array },
      [string]
    >("SELECT note_path, dims, vector FROM note_chunk_embeddings WHERE model = ?")
    .all(model);

  if (rows.length === 0) return 0;

  // Average chunk vectors per note
  const noteVecs = new Map<string, { sum: Float32Array; count: number }>();
  for (const r of rows) {
    const vec = new Float32Array(
      new Uint8Array(r.vector).buffer.slice(0, r.dims * 4),
    );
    let entry = noteVecs.get(r.note_path);
    if (!entry) {
      entry = { sum: new Float32Array(r.dims), count: 0 };
      noteVecs.set(r.note_path, entry);
    }
    for (let k = 0; k < r.dims; k++) entry.sum[k] += vec[k];
    entry.count += 1;
  }

  // Normalize
  const averaged: Array<{ path: string; vec: Float32Array }> = [];
  for (const [path, entry] of noteVecs) {
    const vec = entry.sum;
    for (let k = 0; k < vec.length; k++) vec[k] /= entry.count;
    let norm = 0;
    for (let k = 0; k < vec.length; k++) norm += vec[k] * vec[k];
    norm = Math.sqrt(norm);
    if (norm > 0) for (let k = 0; k < vec.length; k++) vec[k] /= norm;
    averaged.push({ path, vec });
  }

  // Only create edges where at least one side is a new note
  const insert = db.prepare(
    `INSERT OR IGNORE INTO graph_edges
       (source, target, relation, weight, confidence, reason, created_at)
     VALUES (?, ?, 'similarity', ?, 'inferred', 'embedding cosine', ?)`,
  );
  let created = 0;
  const now = Date.now();
  for (let i = 0; i < averaged.length; i++) {
    for (let j = i + 1; j < averaged.length; j++) {
      if (!newPaths.has(averaged[i].path) && !newPaths.has(averaged[j].path))
        continue;
      let score = 0;
      for (let k = 0; k < averaged[i].vec.length; k++)
        score += averaged[i].vec[k] * averaged[j].vec[k];
      if (score >= threshold) {
        const res = insert.run(averaged[i].path, averaged[j].path, score, now);
        if (res.changes > 0) created += 1;
      }
    }
  }
  return created;
}

export const batchIngestTool: ToolDef<Input, Output> = {
  name: "batch_ingest",
  description:
    "Bulk-ingest .md files from an external directory. Writes each file into the vault, embeds content, then creates similarity edges between notes.",
  inputSchema: {
    type: "object",
    properties: {
      source_dir: { type: "string", description: "Absolute path to directory containing .md files" },
      domain: { type: "string", description: "Domain label for organizing ingested notes (default: dirname)" },
      target_prefix: { type: "string", description: "Vault path prefix (default: research/)" },
      batch_size: { type: "number", description: "Files per yield (default: 25)" },
      min_similarity: { type: "number", description: "Cosine threshold for similarity edges (default: 0.8)" },
    },
    required: ["source_dir"],
  },

  async handler(ctx, input, correlationId) {
    const sourceDir = input.source_dir;
    if (!isAbsolute(sourceDir)) {
      throw new Error("source_dir must be an absolute path");
    }

    const domain = input.domain ?? basename(sourceDir);
    const prefix = input.target_prefix ?? "research";
    const batchSize = input.batch_size ?? 25;
    const minSim = input.min_similarity ?? 0.8;
    const model = process.env.SCRYPT_EMBED_MODEL ?? "Xenova/bge-small-en-v1.5";

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
      const tag = clientTag(sourceDir, relPath);
      const vaultPath = `${prefix}/${domain}/${slug(relPath)}.md`;

      try {
        const result = await ctx.idempotency.runCached(
          "batch_ingest",
          tag,
          async () => {
            const content = readFileSync(absSource, "utf8");
            const title = extractTitle(content, relPath);
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
            upsertWikilinkEdges(
              ctx.db,
              vaultPath,
              parsed.wikilinks.map((w) => w.target),
            );

            const embed = await ctx.embedService.embedNote(parsed, correlationId);

            if (ctx.legacyIndexer) {
              try {
                await ctx.legacyIndexer.reindexNote(vaultPath);
              } catch {}
            }

            return {
              note_path: vaultPath,
              chunks_total: embed.chunks_total,
              was_cached: false,
            };
          },
        );

        if (result.was_cached === undefined) {
          // Returned from idempotency cache
          results.push({ source: relPath, vault_path: result.note_path, status: "skip" });
          skipped += 1;
        } else {
          newPaths.add(vaultPath);
          totalChunks += result.chunks_total;
          ingested += 1;
          results.push({ source: relPath, vault_path: vaultPath, status: "ok", chunks: result.chunks_total });
        }
      } catch (err) {
        errored += 1;
        results.push({ source: relPath, vault_path: "", status: "error", error: (err as Error).message });
      }

      // Yield to event loop between batches
      if ((i + 1) % batchSize === 0) {
        await new Promise((r) => setImmediate(r));
      }
    }

    // Compute similarity edges for new notes
    let simEdges = 0;
    if (newPaths.size > 0) {
      simEdges = computeSimilarityEdges(ctx.db, newPaths, model, minSim);
    }

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
