import { test, expect } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { Database } from "bun:sqlite";
import { initSchema } from "../../src/server/db";
import { FileManager } from "../../src/server/file-manager";
import { Indexer } from "../../src/server/indexer";
import { computeContentHash } from "../../src/server/sync/content-hash";
import { SectionsRepo } from "../../src/server/indexer/sections-repo";
import { MetadataRepo } from "../../src/server/indexer/metadata-repo";
import { TasksRepo } from "../../src/server/indexer/tasks-repo";
import { ChunkEmbeddingsRepo } from "../../src/server/embeddings/chunks-repo";
import {
  EmbeddingService,
  type EngineLike,
} from "../../src/server/embeddings/service";
import { ProgressBus } from "../../src/server/embeddings/progress";
import { Idempotency } from "../../src/server/mcp/idempotency";
import { createNoteTool } from "../../src/server/mcp/tools/create-note";
import type { ToolContext } from "../../src/server/mcp/types";

test("indexer-stored content_hash equals the engine's FileManager-based hash", async () => {
  const vaultDir = mkdtempSync(join(tmpdir(), "parity-"));
  mkdirSync(join(vaultDir, ".scrypt"), { recursive: true });
  const rel = "note.md";
  writeFileSync(join(vaultDir, rel), "---\ntitle: Parity\n---\nbody text");
  const db = new Database(":memory:");
  initSchema(db);
  const fm = new FileManager(vaultDir, join(vaultDir, ".scrypt"));
  const indexer = new Indexer(db, fm);
  await indexer.reindexNote(rel, { skipEmbed: true });
  const row = db.query("SELECT content_hash FROM graph_nodes WHERE note_path = ?").get(rel) as { content_hash: string } | null;
  const note = await fm.readNote(rel);
  const engineHash = computeContentHash(note!.frontmatter, note!.content);
  expect(row?.content_hash).toBe(engineHash);
  rmSync(vaultDir, { recursive: true, force: true });
});

// --- F3: re-create hash parity (phantom non-convergence regression guard) ---
//
// create_note historically wrote graph_nodes.content_hash twice in two
// formats: upsertNode wrote sha256(body) (structural-parse's embed cache key),
// then reindexNote was meant to overwrite with the engine's computeContentHash.
// But reindexNote early-returns when notes.content_hash is unchanged, so on a
// RE-create of byte-identical content graph_nodes kept the wrong sha256. The
// /api/sync/manifest endpoint serves graph_nodes.content_hash verbatim, so a
// puller (which recomputes computeContentHash from the markdown it fetched)
// could never reproduce that sha256 -> the note stayed "diverged" forever.
//
// These tests assert the invariant the fix restores: after create then a
// fresh-client_tag re-create of identical content, graph_nodes.content_hash
// (== the manifest hash) equals computeContentHash, i.e. it is reproducible.

class FakeEngine implements EngineLike {
  model = "fake";
  batchSize = 8;
  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    return texts.map(() => {
      const v = new Float32Array(4);
      v[0] = 1;
      return v;
    });
  }
}

function buildCtx(): { ctx: ToolContext; vaultDir: string; db: Database } {
  const vaultDir = mkdtempSync(join(tmpdir(), "scrypt-parity-create-"));
  const db = new Database(":memory:");
  initSchema(db);
  const sections = new SectionsRepo(db);
  const metadata = new MetadataRepo(db);
  const embeddings = new ChunkEmbeddingsRepo(db);
  const bus = new ProgressBus();
  const engine = new FakeEngine();
  const embedService = new EmbeddingService({
    engine,
    repo: embeddings,
    bus,
    chunkOpts: { maxTokens: 450, overlapTokens: 50 },
  });
  const ctx: ToolContext = {
    db,
    sections,
    metadata,
    tasks: new TasksRepo(db),
    embeddings,
    embedService,
    engine,
    bus,
    idempotency: new Idempotency(db),
    userId: "u1",
    vaultDir,
    scheduleGraphRebuild: () => {},
  };
  return { ctx, vaultDir, db };
}

function manifestHash(db: Database, path: string): string | undefined {
  const row = db
    .query(
      `SELECT content_hash AS hash
         FROM graph_nodes
        WHERE kind = 'note' AND note_path = ? AND content_hash IS NOT NULL`,
    )
    .get(path) as { hash: string } | undefined;
  return row?.hash;
}

const RECREATE_BODY = `---
title: Recreate
---

## Alpha

alpha body
`;

test("F3: a single create_note writes the engine hash (not sha256(body)) to graph_nodes", async () => {
  const { ctx, vaultDir, db } = buildCtx();
  try {
    await createNoteTool.handler(
      ctx,
      { path: "n.md", content: RECREATE_BODY, client_tag: "create-1", allow_nonstandard_path: true },
      "corr-1",
    );

    // Derive the engine hash from the same parser the engine uses, so we
    // compare graph_nodes against the true source of truth.
    const onDisk = readFileSync(join(vaultDir, "n.md"), "utf8");
    const { default: matter } = await import("gray-matter");
    const parsed = matter(onDisk);
    const expected = computeContentHash(
      parsed.data as Record<string, unknown>,
      parsed.content,
    );
    const sha = createHash("sha256").update(parsed.content).digest("hex");

    const stored = manifestHash(db, "n.md");
    expect(stored).toBe(expected);
    // The pre-fix bug stored sha256(body); guard explicitly against it.
    expect(stored).not.toBe(sha);
  } finally {
    rmSync(vaultDir, { recursive: true, force: true });
  }
});

test("F3: re-creating byte-identical content keeps graph_nodes hash == computeContentHash", async () => {
  const { ctx, vaultDir, db } = buildCtx();
  try {
    await createNoteTool.handler(
      ctx,
      { path: "n.md", content: RECREATE_BODY, client_tag: "create-a", allow_nonstandard_path: true },
      "corr-a",
    );
    // Re-create identical bytes with a FRESH client_tag so it is a real
    // re-run, not an idempotency cache hit. This is the exact path that fired
    // on every resolveClash and idempotent re-ingest pre-fix.
    await createNoteTool.handler(
      ctx,
      { path: "n.md", content: RECREATE_BODY, client_tag: "create-b", allow_nonstandard_path: true },
      "corr-b",
    );

    const onDisk = readFileSync(join(vaultDir, "n.md"), "utf8");
    const { default: matter } = await import("gray-matter");
    const parsed = matter(onDisk);
    const expected = computeContentHash(
      parsed.data as Record<string, unknown>,
      parsed.content,
    );
    const sha = createHash("sha256").update(parsed.content).digest("hex");

    const stored = manifestHash(db, "n.md");
    // The hub manifest advertises this exact column; a puller recomputes
    // computeContentHash from the fetched markdown and must match.
    expect(stored).toBe(expected);
    expect(stored).not.toBe(sha);
  } finally {
    rmSync(vaultDir, { recursive: true, force: true });
  }
});

test("F3: reindexNote repairs a stale sha256 graph_nodes hash even when notes.content_hash is unchanged", async () => {
  // Simulates the corruption surface: an upstream writer (old create_note,
  // batch-ingest, embeddings/reindex) seeded graph_nodes with sha256(body)
  // while notes.content_hash already holds the engine hash. A reindex of
  // unchanged content must still overwrite graph_nodes BEFORE the
  // unchanged-content early-return, not skip it.
  const vaultDir = mkdtempSync(join(tmpdir(), "parity-reindex-"));
  mkdirSync(join(vaultDir, ".scrypt"), { recursive: true });
  const rel = "stale.md";
  const raw = "---\ntitle: Stale\n---\nbody text";
  writeFileSync(join(vaultDir, rel), raw);
  const db = new Database(":memory:");
  initSchema(db);
  const fm = new FileManager(vaultDir, join(vaultDir, ".scrypt"));
  const indexer = new Indexer(db, fm);

  // First real index -> notes + graph_nodes both carry the engine hash.
  await indexer.reindexNote(rel, { skipEmbed: true });
  const note = await fm.readNote(rel);
  const engineHash = computeContentHash(note!.frontmatter, note!.content);

  // Corrupt graph_nodes with the pre-fix sha256(body) shape, leaving
  // notes.content_hash (== engineHash) untouched so the early-return triggers.
  const bogusSha = createHash("sha256").update(note!.content).digest("hex");
  db.query("UPDATE graph_nodes SET content_hash = ? WHERE id = ?").run(bogusSha, rel);
  expect(manifestHash(db, rel)).toBe(bogusSha); // precondition: corrupted

  // Re-index byte-identical content. notes.content_hash is unchanged, so the
  // body-reindex early-returns; the graph_nodes upsert must run regardless.
  await indexer.reindexNote(rel, { skipEmbed: true });

  expect(manifestHash(db, rel)).toBe(engineHash);
  expect(manifestHash(db, rel)).not.toBe(bogusSha);
  rmSync(vaultDir, { recursive: true, force: true });
});
