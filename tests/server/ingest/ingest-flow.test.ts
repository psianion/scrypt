// tests/server/ingest/ingest-flow.test.ts
// C7 integration: batch_ingest a folder → notes placed + embedded, the C2
// deterministic reference linker writes reference edges during reindex, the
// AI asserts a typed add_edge link, rescan_similarity writes NO graph edges
// (C3 cosine demotion), and generateProjectIndex (C6) writes _index.md.
import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { initSchema } from "../../../src/server/db";
import { SectionsRepo } from "../../../src/server/indexer/sections-repo";
import { MetadataRepo } from "../../../src/server/indexer/metadata-repo";
import { TasksRepo } from "../../../src/server/indexer/tasks-repo";
import { ChunkEmbeddingsRepo } from "../../../src/server/embeddings/chunks-repo";
import { EmbeddingService, type EngineLike } from "../../../src/server/embeddings/service";
import { ProgressBus } from "../../../src/server/embeddings/progress";
import { Idempotency } from "../../../src/server/mcp/idempotency";
import { Indexer } from "../../../src/server/indexer";
import { FileManager } from "../../../src/server/file-manager";
import { batchIngestTool } from "../../../src/server/mcp/tools/batch-ingest";
import { addEdgeTool } from "../../../src/server/mcp/tools/add-edge";
import { updateNoteMetadataTool } from "../../../src/server/mcp/tools/update-note-metadata";
import { rescanSimilarityTool } from "../../../src/server/mcp/tools/rescan-similarity";
import { generateProjectIndex } from "../../../src/server/ingest/index-note";
import type { ToolContext } from "../../../src/server/mcp/types";

// Use the real model id so embedding queries on note_chunk_embeddings match.
const EMBED_MODEL = "Xenova/bge-small-en-v1.5";

class FakeEngine implements EngineLike {
  model = EMBED_MODEL;
  batchSize = 8;
  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    // Return near-identical vectors so cosine > threshold — this lets us
    // assert that rescan_similarity returns pairs but writes NO graph edges.
    return texts.map((_, i) => {
      const v = new Float32Array(4);
      v[0] = 1;
      v[1] = 0.9;
      v[i % 4] = 0.1; // tiny variation to avoid identical-vector short-circuit
      return v;
    });
  }
}

let srcDir: string, vaultDir: string, db: Database, ctx: ToolContext, indexer: Indexer, fm: FileManager;

beforeEach(() => {
  srcDir = mkdtempSync(join(tmpdir(), "ingest-src-"));
  vaultDir = mkdtempSync(join(tmpdir(), "ingest-vault-"));
  db = new Database(":memory:");
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
  fm = new FileManager(vaultDir, join(vaultDir, ".scrypt"));
  // Wire the real Indexer as legacyIndexer so C2 reference linker runs.
  // Indexer 3rd arg = Wave8Pipeline = { sections, embedService }.
  indexer = new Indexer(db, fm, { sections, embedService });
  ctx = {
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
    legacyIndexer: indexer,
  } as unknown as ToolContext;
});

afterEach(() => {
  rmSync(srcDir, { recursive: true, force: true });
  rmSync(vaultDir, { recursive: true, force: true });
});

test("ingest flow: batch_ingest → embed + reference edges → typed edge → _index.md, no similarity edges", async () => {
  writeFileSync(join(srcDir, "core-architecture.md"), "# Core Architecture\n\nThe system layers.\n");
  // Use a relative markdown link — the common inter-note form.
  // This exercises relative-path resolution: source projects/scrypt/spec/auth-spec.md
  // + target core-architecture.md → projects/scrypt/spec/core-architecture.md.
  writeFileSync(join(srcDir, "auth-spec.md"), "# Auth Spec\n\nSee [Core Architecture](core-architecture.md) for the layering.\n");

  // ── C1/ingest: place files and embed chunks ───────────────────────────────
  const out = await batchIngestTool.handler(
    ctx,
    { source_dir: srcDir, project: "scrypt", doc_type: "spec", client_tag: "ingest:scrypt:v1" },
    "corr-1",
  );
  expect(out.ingested).toBe(2);

  const archPath = "projects/scrypt/spec/core-architecture.md";
  const specPath = "projects/scrypt/spec/auth-spec.md";
  expect(existsSync(join(vaultDir, archPath))).toBe(true);
  expect(existsSync(join(vaultDir, specPath))).toBe(true);

  // ── C5: chunk embeddings written ─────────────────────────────────────────
  const embRows = db
    .query<{ note_path: string }, [string]>(
      `SELECT DISTINCT note_path FROM note_chunk_embeddings WHERE model = ?`,
    )
    .all(EMBED_MODEL)
    .map((r) => r.note_path);
  expect(embRows).toContain(archPath);
  expect(embRows).toContain(specPath);

  // ── C2: deterministic reference edges (client_tag IS NULL) ───────────────
  // batch_ingest processes files sequentially; when auth-spec.md is ingested
  // first, core-architecture.md is not yet in the notes table, so resolveLink
  // returns null (mirrors the known ordering limitation documented in
  // fullReindex's two-pass comment). A second-pass reindex of the linking note
  // — after both files are in the DB — lets resolveLink succeed and writes the
  // structural graph_edge. This matches fullReindex's two-pass pattern.
  await indexer.reindexNote(specPath);

  const refEdges = db
    .query<{ source: string; target: string; reason: string | null }, []>(
      `SELECT source, target, reason FROM graph_edges WHERE client_tag IS NULL`,
    )
    .all();
  expect(
    refEdges.some(
      (e) =>
        e.source === specPath &&
        e.target === archPath &&
        (e.reason === "reference" || e.reason === "cites"),
    ),
  ).toBe(true);

  // ── C4: AI-asserted typed edge via add_edge ───────────────────────────────
  await updateNoteMetadataTool.handler(
    ctx,
    { path: archPath, doc_type: "architecture", summary: "Layered system architecture reference.", project: "scrypt", client_tag: "ingest-meta:arch:v1" },
    "corr-2",
  );
  await updateNoteMetadataTool.handler(
    ctx,
    { path: specPath, doc_type: "spec", summary: "Authentication design spec.", project: "scrypt", client_tag: "ingest-meta:spec:v1" },
    "corr-3",
  );

  const edge = await addEdgeTool.handler(
    ctx,
    { source: specPath, target: archPath, tier: "connected", rel_type: "builds_on", client_tag: "ingest-edge:spec:arch:v1" },
    "corr-4",
  );
  expect(edge.edge_id).toBeGreaterThan(0);
  const typed = db
    .query<{ n: number }, [string, string, string]>(
      `SELECT COUNT(*) AS n FROM graph_edges WHERE source = ? AND target = ? AND rel_type = ? AND client_tag IS NOT NULL`,
    )
    .get(specPath, archPath, "builds_on");
  expect(typed?.n ?? 0).toBe(1);

  // ── C3: rescan_similarity returns pairs but writes NO graph edges ─────────
  const rescan = await rescanSimilarityTool.handler(ctx, { paths: [archPath, specPath] }, "corr-5");
  expect(Array.isArray(rescan.pairs)).toBe(true);
  const simCount = db
    .query<{ n: number }, []>(
      `SELECT COUNT(*) AS n FROM graph_edges WHERE tier = 'semantically_related'`,
    )
    .get();
  expect(simCount?.n ?? 0).toBe(0);

  // ── C6: generateProjectIndex writes _index.md ────────────────────────────
  await generateProjectIndex({ db, fm, metadata: ctx.metadata }, "scrypt");
  const indexPath = join(vaultDir, "projects/scrypt/_index.md");
  expect(existsSync(indexPath)).toBe(true);
  const indexBody = readFileSync(indexPath, "utf8");
  expect(indexBody).toContain("kind: index");
  expect(indexBody).toContain("Authentication design spec.");
  expect(indexBody).toContain("Layered system architecture reference.");
});
