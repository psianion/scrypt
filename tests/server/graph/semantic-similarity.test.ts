// tests/server/graph/semantic-similarity.test.ts
import { test, expect, beforeEach, describe } from "bun:test";
import { Database } from "bun:sqlite";
import { initSchema } from "../../../src/server/db";
import {
  findSimilarPairs,
  upsertSemanticEdges,
  getSimilarityThreshold,
} from "../../../src/server/graph/semantic-similarity";

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

function insertNode(db: Database, path: string): void {
  db.run(
    `INSERT INTO graph_nodes (id, kind, label, note_path) VALUES (?, 'note', ?, ?)`,
    [path, path, path],
  );
}

function insertChunk(
  db: Database,
  path: string,
  chunkId: string,
  vec: number[],
  model = "test-model",
): void {
  db.run(
    `INSERT INTO note_chunk_embeddings
       (note_path, chunk_id, chunk_text, start_line, end_line, model, dims, vector, content_hash, created_at)
     VALUES (?, ?, '', 0, 0, ?, ?, ?, ?, ?)`,
    [path, chunkId, model, vec.length, unitVec(vec), `h-${path}-${chunkId}`, Date.now()],
  );
}

describe("graph/semantic-similarity", () => {
  let db: Database;
  beforeEach(() => {
    db = new Database(":memory:");
    initSchema(db);
  });

  describe("findSimilarPairs", () => {
    test("returns pairs above threshold, ordered by score desc", () => {
      // a and b: identical → cosine ~1
      // a and c: orthogonal → cosine ~0
      insertChunk(db, "a.md", "a:1", [1, 0, 0]);
      insertChunk(db, "b.md", "b:1", [1, 0, 0]);
      insertChunk(db, "c.md", "c:1", [0, 1, 0]);

      const pairs = findSimilarPairs(db, ["a.md", "b.md", "c.md"], "test-model", {
        minSimilarity: 0.5,
      });
      expect(pairs).toHaveLength(1);
      expect(pairs[0].source).toBe("a.md");
      expect(pairs[0].target).toBe("b.md");
      expect(pairs[0].score).toBeGreaterThan(0.99);
    });

    test("only emits each pair once (a→b not also b→a)", () => {
      insertChunk(db, "a.md", "a:1", [1, 0, 0]);
      insertChunk(db, "b.md", "b:1", [1, 0, 0]);
      const pairs = findSimilarPairs(db, ["a.md", "b.md"], "test-model", {
        minSimilarity: 0.5,
      });
      expect(pairs).toHaveLength(1);
    });

    test("averages multiple chunks per note before comparing", () => {
      // a's two chunks average to roughly [0.5, 0.5, 0]
      insertChunk(db, "a.md", "a:1", [1, 0, 0]);
      insertChunk(db, "a.md", "a:2", [0, 1, 0]);
      // b matches that average
      insertChunk(db, "b.md", "b:1", [0.5, 0.5, 0]);
      const pairs = findSimilarPairs(db, ["a.md", "b.md"], "test-model", {
        minSimilarity: 0.95,
      });
      expect(pairs).toHaveLength(1);
    });

    test("filters out pairs below threshold", () => {
      insertChunk(db, "a.md", "a:1", [1, 0, 0]);
      insertChunk(db, "b.md", "b:1", [0.7, 0.7, 0]);
      const pairs = findSimilarPairs(db, ["a.md", "b.md"], "test-model", {
        minSimilarity: 0.99,
      });
      expect(pairs).toHaveLength(0);
    });

    test("scopedTo limits comparisons to involve at least one scoped path", () => {
      insertChunk(db, "a.md", "a:1", [1, 0, 0]);
      insertChunk(db, "b.md", "b:1", [1, 0, 0]);
      insertChunk(db, "c.md", "c:1", [1, 0, 0]);
      // scopedTo c.md → only emit pairs that include c.md
      const pairs = findSimilarPairs(db, ["a.md", "b.md", "c.md"], "test-model", {
        minSimilarity: 0.5,
        scopedTo: new Set(["c.md"]),
      });
      const involvesC = pairs.every((p) => p.source === "c.md" || p.target === "c.md");
      expect(involvesC).toBe(true);
      // a.md ↔ b.md must be excluded since neither is in scopedTo
      const aBeforeB = pairs.find(
        (p) =>
          (p.source === "a.md" && p.target === "b.md") ||
          (p.source === "b.md" && p.target === "a.md"),
      );
      expect(aBeforeB).toBeUndefined();
    });

    test("ignores rows from other models", () => {
      insertChunk(db, "a.md", "a:1", [1, 0, 0], "model-x");
      insertChunk(db, "b.md", "b:1", [1, 0, 0], "model-y");
      const pairs = findSimilarPairs(db, ["a.md", "b.md"], "model-x", {
        minSimilarity: 0.5,
      });
      // Only a.md has rows in model-x — no second note to pair with.
      expect(pairs).toHaveLength(0);
    });
  });

  describe("upsertSemanticEdges", () => {
    test("inserts edges with relation+confidence semantically_related and reason", () => {
      insertNode(db, "a.md");
      insertNode(db, "b.md");
      const created = upsertSemanticEdges(db, [
        { source: "a.md", target: "b.md", score: 0.92 },
      ]);
      expect(created).toBe(1);
      const row = db
        .query<
          { relation: string; confidence: string; reason: string; weight: number },
          []
        >(`SELECT relation, confidence, reason, weight FROM graph_edges WHERE source='a.md' AND target='b.md'`)
        .get();
      expect(row?.relation).toBe("semantically_related");
      expect(row?.confidence).toBe("semantically_related");
      expect(row?.reason).toContain("cosine");
      expect(row?.weight).toBeCloseTo(0.92, 2);
    });

    test("idempotent — same pair twice does not double insert", () => {
      insertNode(db, "a.md");
      insertNode(db, "b.md");
      upsertSemanticEdges(db, [{ source: "a.md", target: "b.md", score: 0.9 }]);
      const second = upsertSemanticEdges(db, [
        { source: "a.md", target: "b.md", score: 0.95 },
      ]);
      expect(second).toBe(0);
      const total = db
        .query<{ c: number }, []>(
          `SELECT COUNT(*) AS c FROM graph_edges WHERE source='a.md' AND target='b.md'`,
        )
        .get()?.c;
      expect(total).toBe(1);
    });

    test("returns 0 for empty input", () => {
      expect(upsertSemanticEdges(db, [])).toBe(0);
    });
  });

  describe("getSimilarityThreshold", () => {
    test("default is 0.75 per spec §4.2", () => {
      delete process.env.SCRYPT_SIMILARITY_THRESHOLD;
      expect(getSimilarityThreshold()).toBe(0.75);
    });

    test("reads SCRYPT_SIMILARITY_THRESHOLD env var", () => {
      process.env.SCRYPT_SIMILARITY_THRESHOLD = "0.9";
      expect(getSimilarityThreshold()).toBe(0.9);
      delete process.env.SCRYPT_SIMILARITY_THRESHOLD;
    });

    test("clamps to [0, 1] and falls back on garbage input", () => {
      process.env.SCRYPT_SIMILARITY_THRESHOLD = "garbage";
      expect(getSimilarityThreshold()).toBe(0.75);
      process.env.SCRYPT_SIMILARITY_THRESHOLD = "1.5";
      expect(getSimilarityThreshold()).toBe(1);
      process.env.SCRYPT_SIMILARITY_THRESHOLD = "-0.2";
      expect(getSimilarityThreshold()).toBe(0);
      delete process.env.SCRYPT_SIMILARITY_THRESHOLD;
    });
  });
});
