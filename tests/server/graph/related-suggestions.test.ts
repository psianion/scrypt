import { test, expect, beforeEach, describe } from "bun:test";
import { Database } from "bun:sqlite";
import { applyWave8Migration } from "../../../src/server/migrations/wave8";
import { relatedSuggestions } from "../../../src/server/graph/semantic-similarity";

const MODEL = "test-model";

function unitVec(values: number[]): Uint8Array {
  const f = new Float32Array(values.length);
  let n = 0;
  for (let i = 0; i < values.length; i++) { f[i] = values[i]; n += values[i] ** 2; }
  const norm = Math.sqrt(n);
  for (let i = 0; i < values.length; i++) f[i] /= norm;
  return new Uint8Array(f.buffer);
}

function seedChunk(db: Database, path: string, vec: number[]): void {
  db.run(
    `INSERT INTO note_chunk_embeddings
       (note_path, chunk_id, chunk_text, start_line, end_line, model, dims, vector, content_hash, created_at)
     VALUES (?, '1', '', 0, 0, ?, ?, ?, ?, ?)`,
    [path, MODEL, vec.length, unitVec(vec), `h-${path}`, Date.now()],
  );
}

describe("relatedSuggestions", () => {
  let db: Database;
  beforeEach(() => { db = new Database(":memory:"); applyWave8Migration(db); });

  test("returns top-N neighbors ranked by cosine, excluding the source", () => {
    seedChunk(db, "a.md", [1, 0, 0]);
    seedChunk(db, "b.md", [0.9, 0.1, 0]);
    seedChunk(db, "c.md", [0.2, 0.9, 0]);
    seedChunk(db, "d.md", [0, 0, 1]);
    const out = relatedSuggestions(db, "a.md", MODEL, 2);
    expect(out.length).toBe(2);
    expect(out.map((r) => r.path)).toEqual(["b.md", "c.md"]);
    expect(out[0].score).toBeGreaterThan(out[1].score);
    expect(out.some((r) => r.path === "a.md")).toBe(false);
  });

  test("returns empty when the source has no embeddings", () => {
    seedChunk(db, "b.md", [1, 0, 0]);
    expect(relatedSuggestions(db, "missing.md", MODEL, 5)).toEqual([]);
  });
});
