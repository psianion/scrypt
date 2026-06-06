// tests/server/mcp/tools/rescan-similarity.test.ts
import { test, expect, beforeEach, describe } from "bun:test";
import { Database } from "bun:sqlite";
import { initSchema } from "../../../../src/server/db";
import { SectionsRepo } from "../../../../src/server/indexer/sections-repo";
import { MetadataRepo } from "../../../../src/server/indexer/metadata-repo";
import { TasksRepo } from "../../../../src/server/indexer/tasks-repo";
import { ChunkEmbeddingsRepo } from "../../../../src/server/embeddings/chunks-repo";
import { ProgressBus } from "../../../../src/server/embeddings/progress";
import { Idempotency } from "../../../../src/server/mcp/idempotency";
import { rescanSimilarityTool } from "../../../../src/server/mcp/tools/rescan-similarity";
import type { ToolContext } from "../../../../src/server/mcp/types";
import type { EngineLike } from "../../../../src/server/embeddings/service";
import { MCP_ERROR } from "../../../../src/server/mcp/errors";

const MODEL = "test-model";

function unitVec(values: number[]): Uint8Array {
  const f = new Float32Array(values.length);
  let n = 0;
  for (let i = 0; i < values.length; i++) {
    f[i] = values[i];
    n += values[i] ** 2;
  }
  const norm = Math.sqrt(n);
  for (let i = 0; i < values.length; i++) f[i] /= norm;
  return new Uint8Array(f.buffer);
}

function seedNote(db: Database, path: string, vec: number[]): void {
  db.run(
    `INSERT INTO graph_nodes (id, kind, label, note_path) VALUES (?, 'note', ?, ?)`,
    [path, path, path],
  );
  db.run(
    `INSERT INTO note_chunk_embeddings
       (note_path, chunk_id, chunk_text, start_line, end_line, model, dims, vector, content_hash, created_at)
     VALUES (?, '1', '', 0, 0, ?, ?, ?, ?, ?)`,
    [path, MODEL, vec.length, unitVec(vec), `h-${path}`, Date.now()],
  );
}

function buildCtx(): ToolContext {
  const db = new Database(":memory:");
  initSchema(db);
  const stubEngine: EngineLike = {
    model: MODEL,
    batchSize: 1,
    async embedBatch() {
      return [];
    },
  };
  return {
    db,
    sections: new SectionsRepo(db),
    metadata: new MetadataRepo(db),
    tasks: new TasksRepo(db),
    embeddings: new ChunkEmbeddingsRepo(db),
    embedService: {} as unknown as ToolContext["embedService"],
    engine: stubEngine,
    bus: new ProgressBus(),
    idempotency: new Idempotency(db),
    userId: null,
    vaultDir: "/tmp/vault",
    scheduleGraphRebuild: () => {},
  };
}

describe("rescan_similarity tool", () => {
  let ctx: ToolContext;
  beforeEach(() => {
    ctx = buildCtx();
  });

  test("returns ranked pairs and writes NO graph edges", async () => {
    seedNote(ctx.db, "a.md", [1, 0, 0]);
    seedNote(ctx.db, "b.md", [1, 0, 0]);
    seedNote(ctx.db, "c.md", [0, 1, 0]);
    const r = await rescanSimilarityTool.handler(ctx, { min_similarity: 0.5, model: MODEL }, "c");
    expect(r.pairs_considered).toBe(1);
    expect(r.threshold).toBe(0.5);
    expect(r.model).toBe(MODEL);
    expect(r.pairs.length).toBe(1);
    expect(r.pairs[0]).toMatchObject({ source: "a.md", target: "b.md" });
    const edgeCount = ctx.db.query<{ n: number }, []>(`SELECT COUNT(*) AS n FROM graph_edges`).get();
    expect(edgeCount?.n).toBe(0);
  });

  test("pairs are ranked by descending score when several exceed threshold", async () => {
    // Three notes whose pairwise cosines are all > 0.5 but distinct, so the
    // returned ordering is observable: a·b > b·c > a·c.
    seedNote(ctx.db, "a.md", [1, 0, 0]);
    seedNote(ctx.db, "b.md", [0.9, 0.1, 0]);
    seedNote(ctx.db, "c.md", [0.6, 0.8, 0]);
    const r = await rescanSimilarityTool.handler(ctx, { min_similarity: 0.5, model: MODEL }, "c");
    expect(r.pairs.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < r.pairs.length; i++) {
      expect(r.pairs[i - 1].score).toBeGreaterThanOrEqual(r.pairs[i].score);
    }
  });

  test("scopedTo paths restricts emitted pairs", async () => {
    seedNote(ctx.db, "a.md", [1, 0, 0]);
    seedNote(ctx.db, "b.md", [1, 0, 0]);
    seedNote(ctx.db, "c.md", [1, 0, 0]);
    const r = await rescanSimilarityTool.handler(ctx, { min_similarity: 0.5, model: MODEL, paths: ["c.md"] }, "c");
    expect(r.pairs_considered).toBe(2);
    for (const p of r.pairs) { expect(p.source === "c.md" || p.target === "c.md").toBe(true); }
    const edgeCount = ctx.db.query<{ n: number }, []>(`SELECT COUNT(*) AS n FROM graph_edges`).get();
    expect(edgeCount?.n).toBe(0);
  });

  test("rerun is stable and never writes edges", async () => {
    seedNote(ctx.db, "a.md", [1, 0, 0]);
    seedNote(ctx.db, "b.md", [1, 0, 0]);
    const a = await rescanSimilarityTool.handler(ctx, { min_similarity: 0.5, model: MODEL }, "c");
    const b = await rescanSimilarityTool.handler(ctx, { min_similarity: 0.5, model: MODEL }, "c");
    expect(a.pairs_considered).toBe(1);
    expect(b.pairs_considered).toBe(1);
    const edgeCount = ctx.db.query<{ n: number }, []>(`SELECT COUNT(*) AS n FROM graph_edges`).get();
    expect(edgeCount?.n).toBe(0);
  });

  test("returns zero when fewer than 2 notes have embeddings", async () => {
    seedNote(ctx.db, "a.md", [1, 0, 0]);
    const r = await rescanSimilarityTool.handler(ctx, { model: MODEL }, "c");
    expect(r.pairs_considered).toBe(0);
    expect(r.pairs).toEqual([]);
  });

  test("rejects out-of-range min_similarity", async () => {
    let caught: unknown = null;
    try {
      await rescanSimilarityTool.handler(
        ctx,
        { min_similarity: 1.5, model: MODEL },
        "c",
      );
    } catch (e) {
      caught = e;
    }
    expect(caught).toMatchObject({ code: MCP_ERROR.INVALID_PARAMS });
  });
});
