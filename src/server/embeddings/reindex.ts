// src/server/embeddings/reindex.ts
//
// Walks every .md in the vault, re-parses structurally, and re-runs
// the embedding pipeline. Used by `scrypt-mcp reindex-embeddings` after
// a model swap or when turning embeddings on for an existing vault.
import { readdirSync, statSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { randomUUID } from "node:crypto";
import type { Database } from "bun:sqlite";
import type { EmbeddingService, EngineLike } from "./service";
import type { SectionsRepo } from "../indexer/sections-repo";
import type { MetadataRepo } from "../indexer/metadata-repo";
import { parseStructural } from "../indexer/structural-parse";

export interface ReindexOptions {
  vaultDir: string;
  db: Database;
  sections: SectionsRepo;
  metadata: MetadataRepo;
  embedService: EmbeddingService;
  engine: EngineLike;
  onProgress?: (processed: number, total: number, path: string) => void;
}

function walkMarkdown(dir: string, acc: string[] = [], base = dir): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith(".")) continue;
    const abs = join(dir, entry);
    const st = statSync(abs);
    if (st.isDirectory()) {
      walkMarkdown(abs, acc, base);
    } else if (entry.endsWith(".md")) {
      acc.push(relative(base, abs));
    }
  }
  return acc;
}

export async function reindexVault(
  opts: ReindexOptions,
): Promise<{ processed: number }> {
  const paths = walkMarkdown(opts.vaultDir);
  let processed = 0;
  const upsertNode = opts.db.prepare(
    `INSERT INTO graph_nodes (id, kind, label, note_path, content_hash)
       VALUES (?, 'note', ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       label = excluded.label,
       content_hash = excluded.content_hash`,
  );
  for (const relPath of paths) {
    const content = readFileSync(join(opts.vaultDir, relPath), "utf8");
    const parsed = parseStructural(relPath, content);
    opts.sections.replaceNoteSections(
      relPath,
      parsed.sections.map((s) => ({
        id: s.id,
        headingSlug: s.headingSlug,
        headingText: s.headingText,
        level: s.level,
        startLine: s.startLine,
        endLine: s.endLine,
      })),
    );
    upsertNode.run(relPath, parsed.title, relPath, parsed.contentHash);
    await opts.embedService.embedNote(parsed, randomUUID());
    processed += 1;
    opts.onProgress?.(processed, paths.length, relPath);
  }
  return { processed };
}
