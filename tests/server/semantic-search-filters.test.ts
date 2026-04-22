// tests/server/semantic-search-filters.test.ts
//
// ingest-v3: semantic_search applies project / doc_type / thread filters by
// joining notes post-hoc. Uses a FakeEngine + manually-seeded embeddings.
import { test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { buildCtx, seedNote, type TestCtx } from "../helpers/ctx";
import { semanticSearchTool } from "../../src/server/mcp/tools/semantic-search";
import { ChunkEmbeddingsRepo } from "../../src/server/embeddings/chunks-repo";
import type { ToolContext } from "../../src/server/mcp/types";
import type { EngineLike } from "../../src/server/embeddings/service";

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

function toolCtx(t: TestCtx, embeddings: ChunkEmbeddingsRepo): ToolContext {
  return {
    db: t.db as unknown as Database,
    embeddings,
    engine: new FakeEngine(),
  } as unknown as ToolContext;
}

function seedChunkEmbedding(
  embeddings: ChunkEmbeddingsRepo,
  notePath: string,
  chunkIndex: number,
  text: string,
): void {
  const vec = new Float32Array(4);
  vec[0] = 1; // aligns with FakeEngine query vector → cosine = 1
  embeddings.upsert({
    note_path: notePath,
    chunk_id: `${notePath}:${chunkIndex}`,
    chunk_index: chunkIndex,
    chunk_text: text,
    start_line: 1,
    end_line: 2,
    content_hash: `h-${notePath}-${chunkIndex}`,
    model: "fake",
    dims: 4,
    vector: vec,
  });
}

test("semantic_search filters by doc_type", async () => {
  const ctx = buildCtx();
  try {
    const embeddings = new ChunkEmbeddingsRepo(ctx.db as unknown as Database);
    seedNote(ctx, {
      project: "p",
      doc_type: "plan",
      slug: "a",
      thread: "news-images",
    });
    seedNote(ctx, {
      project: "p",
      doc_type: "spec",
      slug: "b",
      thread: "news-images",
    });
    seedChunkEmbedding(embeddings, "projects/p/plan/a.md", 0, "image upload pipeline");
    seedChunkEmbedding(embeddings, "projects/p/spec/b.md", 0, "image upload design");

    const r = await semanticSearchTool.handler(
      toolCtx(ctx, embeddings),
      { query: "image upload", doc_type: "plan", min_score: -1 },
      "c",
    );
    expect(r.results.length).toBeGreaterThan(0);
    expect(r.results.every((row) => row.doc_type === "plan")).toBe(true);
  } finally {
    ctx.cleanup();
  }
});

test("semantic_search filters by thread", async () => {
  const ctx = buildCtx();
  try {
    const embeddings = new ChunkEmbeddingsRepo(ctx.db as unknown as Database);
    seedNote(ctx, {
      project: "p",
      doc_type: "plan",
      slug: "a",
      thread: "news-images",
    });
    seedNote(ctx, {
      project: "p",
      doc_type: "plan",
      slug: "b",
      thread: "other",
    });
    seedChunkEmbedding(embeddings, "projects/p/plan/a.md", 0, "shared body");
    seedChunkEmbedding(embeddings, "projects/p/plan/b.md", 0, "shared body");

    const r = await semanticSearchTool.handler(
      toolCtx(ctx, embeddings),
      { query: "shared", thread: "news-images", min_score: -1 },
      "c",
    );
    expect(r.results.length).toBeGreaterThan(0);
    expect(r.results.every((row) => row.thread === "news-images")).toBe(true);
  } finally {
    ctx.cleanup();
  }
});

test("semantic_search result rows carry project/doc_type/thread/title", async () => {
  const ctx = buildCtx();
  try {
    const embeddings = new ChunkEmbeddingsRepo(ctx.db as unknown as Database);
    seedNote(ctx, {
      project: "p",
      doc_type: "plan",
      slug: "a",
      thread: "news-images",
      title: "A-Title",
    });
    seedChunkEmbedding(embeddings, "projects/p/plan/a.md", 0, "body");
    const r = await semanticSearchTool.handler(
      toolCtx(ctx, embeddings),
      { query: "body", min_score: -1 },
      "c",
    );
    expect(r.results[0]).toMatchObject({
      project: "p",
      doc_type: "plan",
      thread: "news-images",
      title: "A-Title",
    });
  } finally {
    ctx.cleanup();
  }
});
