// tests/server/embeddings/search.test.ts
import { test, expect, describe } from "bun:test";
import {
  searchChunks,
  groupByNote,
} from "../../../src/server/embeddings/search";
import type { ChunkEmbeddingRow } from "../../../src/server/embeddings/chunks-repo";

function vec(values: number[]): Float32Array {
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

function row(
  path: string,
  id: string,
  v: Float32Array,
  text = id,
): ChunkEmbeddingRow {
  return {
    note_path: path,
    chunk_id: id,
    chunk_text: text,
    start_line: 0,
    end_line: 0,
    model: "m",
    dims: v.length,
    vector: v,
    content_hash: id,
    created_at: 0,
  };
}

describe("searchChunks", () => {
  test("returns chunk-level hits sorted by score desc", () => {
    const q = vec([1, 0, 0]);
    const rows = [
      row("a.md", "ha", vec([1, 0, 0])),
      row("b.md", "hb", vec([0, 1, 0])),
      row("c.md", "hc", vec([0.9, 0.1, 0])),
    ];
    const hits = searchChunks(q, rows, { limit: 10, minScore: 0 });
    expect(hits[0].note_path).toBe("a.md");
    expect(hits[1].note_path).toBe("c.md");
    expect(hits[2].note_path).toBe("b.md");
  });

  test("minScore filters low-similarity rows", () => {
    const q = vec([1, 0, 0]);
    const rows = [
      row("a", "1", vec([1, 0, 0])),
      row("b", "2", vec([-1, 0, 0])),
    ];
    const hits = searchChunks(q, rows, { limit: 10, minScore: 0.5 });
    expect(hits.length).toBe(1);
    expect(hits[0].note_path).toBe("a");
  });
});

describe("groupByNote", () => {
  test("returns max-chunk-score per note with the winning chunk", () => {
    const rows = [
      row("a.md", "a1", vec([1, 0, 0])),
      row("a.md", "a2", vec([0.9, 0.1, 0])),
      row("b.md", "b1", vec([0.2, 0.8, 0])),
    ];
    const q = vec([1, 0, 0]);
    const hits = searchChunks(q, rows, { limit: 10, minScore: 0 });
    const grouped = groupByNote(hits, 10);
    expect(grouped.length).toBe(2);
    expect(grouped[0].note_path).toBe("a.md");
    expect(grouped[0].chunk_id).toBe("a1");
  });

  test("limit caps the number of distinct notes returned", () => {
    const rows = [
      row("a.md", "a", vec([1, 0, 0])),
      row("b.md", "b", vec([0.8, 0.2, 0])),
      row("c.md", "c", vec([0.6, 0.4, 0])),
    ];
    const q = vec([1, 0, 0]);
    const hits = searchChunks(q, rows, { limit: 10, minScore: 0 });
    const grouped = groupByNote(hits, 2);
    expect(grouped.length).toBe(2);
    expect(grouped.map((g) => g.note_path)).toEqual(["a.md", "b.md"]);
  });
});
