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

  test("emits semantically_related edges between similar notes", async () => {
    seedNote(ctx.db, "a.md", [1, 0, 0]);
    seedNote(ctx.db, "b.md", [1, 0, 0]);
    seedNote(ctx.db, "c.md", [0, 1, 0]);
    const r = await rescanSimilarityTool.handler(
      ctx,
      { min_similarity: 0.5, model: MODEL },
      "c",
    );
    expect(r.edges_created).toBe(1);
    expect(r.threshold).toBe(0.5);
    expect(r.model).toBe(MODEL);
    const rel = ctx.db
      .query<{ tier: string }, []>(
        `SELECT tier FROM graph_edges`,
      )
      .all();
    expect(rel).toEqual([{ tier: "semantically_related" }]);
  });

  test("scopedTo paths restricts emitted pairs", async () => {
    seedNote(ctx.db, "a.md", [1, 0, 0]);
    seedNote(ctx.db, "b.md", [1, 0, 0]);
    seedNote(ctx.db, "c.md", [1, 0, 0]);
    const r = await rescanSimilarityTool.handler(
      ctx,
      { min_similarity: 0.5, model: MODEL, paths: ["c.md"] },
      "c",
    );
    // a↔b excluded; only a↔c and b↔c
    expect(r.edges_created).toBe(2);
    const rows = ctx.db
      .query<{ source: string; target: string }, []>(
        `SELECT source, target FROM graph_edges`,
      )
      .all();
    for (const row of rows) {
      expect(row.source === "c.md" || row.target === "c.md").toBe(true);
    }
  });

  test("idempotent across reruns", async () => {
    seedNote(ctx.db, "a.md", [1, 0, 0]);
    seedNote(ctx.db, "b.md", [1, 0, 0]);
    const a = await rescanSimilarityTool.handler(
      ctx,
      { min_similarity: 0.5, model: MODEL },
      "c",
    );
    const b = await rescanSimilarityTool.handler(
      ctx,
      { min_similarity: 0.5, model: MODEL },
      "c",
    );
    expect(a.edges_created).toBe(1);
    expect(b.edges_created).toBe(0);
  });

  test("returns zero when fewer than 2 notes have embeddings", async () => {
    seedNote(ctx.db, "a.md", [1, 0, 0]);
    const r = await rescanSimilarityTool.handler(ctx, { model: MODEL }, "c");
    expect(r.edges_created).toBe(0);
    expect(r.pairs_considered).toBe(0);
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
