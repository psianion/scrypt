// tests/server/embeddings/chunks-repo.test.ts
import { test, expect, beforeEach, describe } from "bun:test";
import { Database } from "bun:sqlite";
import { applyWave8Migration } from "../../../src/server/migrations/wave8";
import { ChunkEmbeddingsRepo } from "../../../src/server/embeddings/chunks-repo";

function unitVec(seed: number, dim = 384): Float32Array {
  const v = new Float32Array(dim);
  for (let i = 0; i < dim; i++) v[i] = Math.sin(i + seed);
  let n = 0;
  for (const x of v) n += x * x;
  const norm = Math.sqrt(n);
  for (let i = 0; i < dim; i++) v[i] /= norm;
  return v;
}

describe("ChunkEmbeddingsRepo", () => {
  let db: Database;
  let repo: ChunkEmbeddingsRepo;
  beforeEach(() => {
    db = new Database(":memory:");
    applyWave8Migration(db);
    repo = new ChunkEmbeddingsRepo(db);
  });

  test("upsert stores and listByNote returns rows", () => {
    repo.upsert({
      note_path: "a.md",
      chunk_id: "a:intro",
      chunk_text: "hello",
      start_line: 0,
      end_line: 3,
      model: "bge-small",
      dims: 384,
      vector: unitVec(1),
      content_hash: "h1",
    });
    const rows = repo.listByNote("a.md", "bge-small");
    expect(rows.length).toBe(1);
    expect(rows[0].chunk_id).toBe("a:intro");
    expect(rows[0].vector.length).toBe(384);
    // Vector hydration preserves ~unit norm.
    let norm = 0;
    for (let i = 0; i < 384; i++) norm += rows[0].vector[i] ** 2;
    expect(Math.sqrt(norm)).toBeGreaterThan(0.99);
  });

  test("upsert replaces existing chunk with same primary key", () => {
    repo.upsert({
      note_path: "a.md",
      chunk_id: "c1",
      chunk_text: "v1",
      start_line: 0,
      end_line: 1,
      model: "m",
      dims: 384,
      vector: unitVec(1),
      content_hash: "h1",
    });
    repo.upsert({
      note_path: "a.md",
      chunk_id: "c1",
      chunk_text: "v2",
      start_line: 0,
      end_line: 1,
      model: "m",
      dims: 384,
      vector: unitVec(2),
      content_hash: "h2",
    });
    const rows = repo.listByNote("a.md", "m");
    expect(rows.length).toBe(1);
    expect(rows[0].chunk_text).toBe("v2");
    expect(rows[0].content_hash).toBe("h2");
  });

  test("hasFreshChunk returns true only when hash matches", () => {
    repo.upsert({
      note_path: "a.md",
      chunk_id: "c1",
      chunk_text: "v1",
      start_line: 0,
      end_line: 1,
      model: "m",
      dims: 384,
      vector: unitVec(1),
      content_hash: "h1",
    });
    expect(repo.hasFreshChunk("a.md", "c1", "m", "h1")).toBe(true);
    expect(repo.hasFreshChunk("a.md", "c1", "m", "h2")).toBe(false);
    expect(repo.hasFreshChunk("a.md", "c1", "other-model", "h1")).toBe(false);
  });

  test("deleteMissingChunks removes chunks no longer present in the keep set", () => {
    for (const id of ["c1", "c2", "c3"]) {
      repo.upsert({
        note_path: "a.md",
        chunk_id: id,
        chunk_text: id,
        start_line: 0,
        end_line: 1,
        model: "m",
        dims: 384,
        vector: unitVec(1),
        content_hash: id,
      });
    }
    repo.deleteMissingChunks("a.md", "m", new Set(["c1", "c3"]));
    const rows = repo
      .listByNote("a.md", "m")
      .map((r) => r.chunk_id)
      .sort();
    expect(rows).toEqual(["c1", "c3"]);
  });

  test("scanAll yields rows for the configured model only", () => {
    repo.upsert({
      note_path: "a.md",
      chunk_id: "c",
      chunk_text: "x",
      start_line: 0,
      end_line: 0,
      model: "m1",
      dims: 384,
      vector: unitVec(1),
      content_hash: "h",
    });
    repo.upsert({
      note_path: "b.md",
      chunk_id: "c",
      chunk_text: "y",
      start_line: 0,
      end_line: 0,
      model: "m2",
      dims: 384,
      vector: unitVec(1),
      content_hash: "h",
    });
    const rows = repo.scanAll("m1");
    expect(rows.length).toBe(1);
    expect(rows[0].note_path).toBe("a.md");
  });

  test("countByModel", () => {
    repo.upsert({
      note_path: "a.md",
      chunk_id: "c",
      chunk_text: "x",
      start_line: 0,
      end_line: 0,
      model: "m1",
      dims: 384,
      vector: unitVec(1),
      content_hash: "h",
    });
    expect(repo.countByModel("m1")).toBe(1);
    expect(repo.countByModel("nope")).toBe(0);
  });
});
