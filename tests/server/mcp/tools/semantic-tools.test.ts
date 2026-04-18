// tests/server/mcp/tools/semantic-tools.test.ts
import { test, expect, beforeEach, describe } from "bun:test";
import { Database } from "bun:sqlite";
import { initSchema } from "../../../../src/server/db";
import { SectionsRepo } from "../../../../src/server/indexer/sections-repo";
import { MetadataRepo } from "../../../../src/server/indexer/metadata-repo";
import { TasksRepo } from "../../../../src/server/indexer/tasks-repo";
import { ChunkEmbeddingsRepo } from "../../../../src/server/embeddings/chunks-repo";
import { ProgressBus } from "../../../../src/server/embeddings/progress";
import { Idempotency } from "../../../../src/server/mcp/idempotency";
import { semanticSearchTool } from "../../../../src/server/mcp/tools/semantic-search";
import { findSimilarTool } from "../../../../src/server/mcp/tools/find-similar";
import type { ToolContext } from "../../../../src/server/mcp/types";
import type { EngineLike } from "../../../../src/server/embeddings/service";
import { MCP_ERROR } from "../../../../src/server/mcp/errors";

function unitVec(values: number[]): Float32Array {
  const f = new Float32Array(values.length);
  let n = 0;
  for (let i = 0; i < values.length; i++) {
    f[i] = values[i];
    n += values[i] ** 2;
  }
  const norm = Math.sqrt(n);
  for (let i = 0; i < values.length; i++) f[i] /= norm;
  return f;
}

class FakeEngine implements EngineLike {
  model = "fake";
  batchSize = 8;
  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    return texts.map((t) => {
      const parts = t.split(",").map(Number);
      return unitVec(parts);
    });
  }
}

describe("semantic_search + find_similar", () => {
  let ctx: ToolContext;

  beforeEach(() => {
    const db = new Database(":memory:");
    initSchema(db);
    const embeddings = new ChunkEmbeddingsRepo(db);
    embeddings.upsert({
      note_path: "rl.md",
      chunk_id: "rl_md:intro",
      chunk_text: "reinforcement learning intro",
      start_line: 0,
      end_line: 1,
      model: "fake",
      dims: 3,
      vector: unitVec([1, 0, 0]),
      content_hash: "h1",
    });
    embeddings.upsert({
      note_path: "cooking.md",
      chunk_id: "cooking_md:intro",
      chunk_text: "baking bread",
      start_line: 0,
      end_line: 1,
      model: "fake",
      dims: 3,
      vector: unitVec([0, 1, 0]),
      content_hash: "h2",
    });
    embeddings.upsert({
      note_path: "rl.md",
      chunk_id: "rl_md:pg",
      chunk_text: "policy gradients",
      start_line: 5,
      end_line: 10,
      model: "fake",
      dims: 3,
      vector: unitVec([0.9, 0.1, 0]),
      content_hash: "h3",
    });
    db.query(
      `INSERT INTO graph_nodes (id, kind, label, note_path) VALUES
         ('rl.md', 'note', 'RL', 'rl.md'),
         ('cooking.md', 'note', 'Cook', 'cooking.md')`,
    ).run();

    ctx = {
      db,
      sections: new SectionsRepo(db),
      metadata: new MetadataRepo(db),
      tasks: new TasksRepo(db),
      embeddings,
      embedService: {} as unknown as ToolContext["embedService"],
      engine: new FakeEngine(),
      bus: new ProgressBus(),
      idempotency: new Idempotency(db),
      userId: null,
      vaultDir: "/tmp",
    };
  });

  test("semantic_search returns top notes grouped", async () => {
    const r = await semanticSearchTool.handler(
      ctx,
      { query: "1,0,0", limit: 10, min_score: 0 },
      "c",
    );
    expect(r.model).toBe("fake");
    expect(r.results[0].path).toBe("rl.md");
    expect(r.results[0].chunk_id).toBe("rl_md:intro");
  });

  test("semantic_search errors when SCRYPT_EMBED_DISABLE=1", async () => {
    process.env.SCRYPT_EMBED_DISABLE = "1";
    try {
      let caught: unknown = null;
      try {
        await semanticSearchTool.handler(ctx, { query: "1,0,0" }, "c");
      } catch (e) {
        caught = e;
      }
      expect(caught).toMatchObject({ code: MCP_ERROR.EMBED_DISABLED });
    } finally {
      delete process.env.SCRYPT_EMBED_DISABLE;
    }
  });

  test("find_similar uses every chunk of source and self-excludes", async () => {
    const r = await findSimilarTool.handler(
      ctx,
      { path: "rl.md", limit: 10, min_score: 0 },
      "c",
    );
    expect(r.results.map((h) => h.path)).not.toContain("rl.md");
  });

  test("semantic_search tag filter narrows results via note metadata", async () => {
    ctx.metadata.upsert("rl.md", { auto_tags: ["ml"] });
    ctx.metadata.upsert("cooking.md", { auto_tags: ["food"] });
    const r = await semanticSearchTool.handler(
      ctx,
      { query: "1,1,0", limit: 10, min_score: 0, tag: "food" },
      "c",
    );
    expect(r.results.map((h) => h.path)).toEqual(["cooking.md"]);
  });
});
