// tests/helpers/ctx.ts
//
// Shared test harness for MCP tools and REST handlers that need a seeded
// SQLite DB + a throwaway vault dir. Used by Phase 2/3 tests of the
// project-first ingest migration.
import { Database } from "bun:sqlite";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { initSchema } from "../../src/server/db";
import { stringifyFrontmatter } from "../../src/server/parsers";
import { INGEST_VERSION } from "../../src/server/ingest/ingest-block";

export interface TestCtx {
  db: Database;
  vaultDir: string;
  cleanup: () => void;
}

export function buildCtx(): TestCtx {
  const vaultDir = mkdtempSync(join(tmpdir(), "vault-test-"));
  const db = new Database(":memory:");
  initSchema(db); // picks up every migration wave, including wave10 columns.
  return {
    db,
    vaultDir,
    cleanup: () => {
      db.close();
      try {
        rmSync(vaultDir, { recursive: true, force: true });
      } catch {
        // best-effort cleanup
      }
    },
  };
}

export function minimalIngestBlock() {
  return {
    original_filename: "src.md",
    original_path: "/abs/src.md",
    source_hash: "sha256:ab",
    source_size: 1,
    source_mtime: "2026-04-22T00:00:00Z",
    ingested_at: "2026-04-22T00:00:00Z",
    tokens: null,
    cost_usd: null,
    model: null,
    ingest_version: INGEST_VERSION,
  };
}

export interface SeedNoteOpts {
  project: string;
  doc_type: string;
  slug: string;
  thread?: string | null;
  body?: string;
  title?: string;
}

export function seedNote(ctx: TestCtx, opts: SeedNoteOpts): string {
  const path = `projects/${opts.project}/${opts.doc_type}/${opts.slug}.md`;
  const title = opts.title ?? opts.slug;
  const fm = {
    title,
    slug: opts.slug,
    project: opts.project,
    doc_type: opts.doc_type,
    thread: opts.thread ?? null,
    tags: [],
    ingest: minimalIngestBlock(),
  };
  const content = stringifyFrontmatter(fm, opts.body ?? `# ${title}\n\nbody`);
  const abs = resolve(ctx.vaultDir, path);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content, "utf8");
  ctx.db.run(
    `INSERT INTO notes (path, title, project, doc_type, thread) VALUES (?, ?, ?, ?, ?)`,
    [path, title, opts.project, opts.doc_type, opts.thread ?? null],
  );
  // Mirror the create_note graph_nodes upsert so add_edge endpoint checks
  // (which look up graph_nodes) can find the seeded endpoints.
  ctx.db.run(
    `INSERT INTO graph_nodes (id, kind, label, note_path, content_hash)
       VALUES (?, 'note', ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET label = excluded.label`,
    [path, title, path, `hash:${path}`],
  );
  return path;
}

export interface SeedEdgeOpts {
  source: string;
  target: string;
  tier: string;
  reason?: string | null;
}

export function seedEdge(ctx: TestCtx, opts: SeedEdgeOpts): void {
  ctx.db.run(
    `INSERT INTO graph_edges (source, target, tier, reason, client_tag) VALUES (?, ?, ?, ?, ?)`,
    [
      opts.source,
      opts.target,
      opts.tier,
      opts.reason ?? null,
      `seed:${opts.source}:${opts.target}:${opts.tier}`,
    ],
  );
}
