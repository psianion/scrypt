// tests/server/graph/hybrid-search.test.ts
//
// G5: hybrid graph search blends BM25 (FTS5) + cosine semantic via
// Reciprocal Rank Fusion (k=60), with optional graph-proximity boost.
import { test, expect, describe, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { initSchema } from "../../../src/server/db";
import { ChunkEmbeddingsRepo } from "../../../src/server/embeddings/chunks-repo";
import { hybridSearch } from "../../../src/server/graph/hybrid-search";
import type { GraphSnapshot } from "../../../src/server/graph/snapshot";
import type { EngineLike } from "../../../src/server/embeddings/service";

function unitVec(values: number[]): Float32Array {
  const v = new Float32Array(values);
  let n = 0;
  for (const x of v) n += x * x;
  const norm = Math.sqrt(n) || 1;
  for (let i = 0; i < v.length; i++) v[i] /= norm;
  return v;
}

function seedNote(
  db: Database,
  path: string,
  title: string,
  body: string,
): number {
  db.query(
    `INSERT INTO notes (path, title, content_hash) VALUES (?, ?, ?)`,
  ).run(path, title, "h");
  const id = Number(
    (db.query("SELECT last_insert_rowid() AS id").get() as { id: number }).id,
  );
  db.query(
    `INSERT INTO graph_nodes (id, kind, label, note_path) VALUES (?, 'note', ?, ?)`,
  ).run(path, title, path);
  db.query(
    `INSERT INTO notes_fts (rowid, title, content, path, summary, entities, themes, edge_reasons)
     VALUES (?, ?, ?, ?, '', '', '', '')`,
  ).run(id, title, body, path);
  return id;
}

function seedEmbedding(
  repo: ChunkEmbeddingsRepo,
  notePath: string,
  vector: Float32Array,
  model: string,
) {
  repo.upsert({
    note_path: notePath,
    chunk_id: `${notePath}:0`,
    chunk_text: notePath,
    start_line: 0,
    end_line: 1,
    model,
    dims: vector.length,
    vector,
    content_hash: notePath,
  });
}

function seedEdge(
  db: Database,
  source: string,
  target: string,
  reason: string | null = null,
) {
  db.query(
    `INSERT INTO graph_edges (source, target, tier, weight, reason)
     VALUES (?, ?, 'mentions', 1.0, ?)`,
  ).run(source, target, reason);
}

function makeEngine(map: Record<string, Float32Array>): EngineLike {
  return {
    model: "stub",
    batchSize: 1,
    async embedBatch(texts: string[]) {
      return texts.map((t) => map[t] ?? unitVec([1, 0, 0]));
    },
  };
}

describe("hybridSearch", () => {
  let db: Database;
  let repo: ChunkEmbeddingsRepo;
  beforeEach(() => {
    db = new Database(":memory:");
    initSchema(db);
    repo = new ChunkEmbeddingsRepo(db);
  });

  test("FTS-only hit: literal term in body surfaces as top hit", async () => {
    seedNote(db, "a.md", "Alpha", "alpha body");
    seedNote(db, "b.md", "Beta", "beta body about graphify here");
    seedNote(db, "c.md", "Gamma", "gamma body");
    seedNote(db, "d.md", "Delta", "delta body");
    seedNote(db, "e.md", "Epsilon", "epsilon body");
    const hits = await hybridSearch(db, { query: "graphify" });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.path).toBe("b.md");
    expect(hits[0]!.fts_rank).toBe(1);
  });

  test("Semantic-only hit: no literal term but embedding aligns", async () => {
    seedNote(db, "x.md", "Force layout tool", "a force-directed graph layout tool");
    seedNote(db, "y.md", "Unrelated", "completely unrelated content");
    const queryVec = unitVec([1, 0, 0]);
    seedEmbedding(repo, "x.md", unitVec([1, 0.01, 0]), "stub");
    seedEmbedding(repo, "y.md", unitVec([0, 1, 0]), "stub");
    const engine = makeEngine({ graphify: queryVec });
    const hits = await hybridSearch(db, {
      query: "graphify",
      engine,
      embeddings: repo,
    });
    const xHit = hits.find((h) => h.path === "x.md");
    expect(xHit).toBeDefined();
    expect(xHit!.sem_rank).toBe(1);
    expect(xHit!.fts_rank).toBe(null);
  });

  test("RRF combines fairly: A is FTS-1/sem-50, B is FTS-50/sem-1 → both in top 10", async () => {
    // Seed 49 generic notes plus B.md so all 50 literal "alpha" hits fit
    // inside the FTS5 top-50 cutoff. n0..n48 vary the term frequency so
    // bm25 produces a stable ordering with B.md ranked last.
    for (let i = 0; i < 49; i++) {
      const reps = 5 - Math.min(4, Math.floor(i / 12));
      const body = ("alpha ".repeat(reps) + `rrfword body ${i}`).trim();
      seedNote(db, `n${i}.md`, `T${i}`, body);
    }
    // B.md mentions "alpha" once with lots of filler so its bm25 is the worst.
    seedNote(
      db,
      "B.md",
      "Bnote",
      "alpha " + "filler ".repeat(80),
    );
    const queryVec = unitVec([1, 0, 0, 0, 0, 0, 0, 0]);
    // Embeddings: B is the strongest cosine match (sem-rank 1). The n* notes
    // are tuned so n0 has the weakest alignment of the bunch (sem-rank 50)
    // while still beating minScore — flips the FTS ordering on the sem axis.
    seedEmbedding(repo, "B.md", unitVec([1, 0.001, 0, 0, 0, 0, 0, 0]), "stub");
    for (let i = 0; i < 49; i++) {
      const align = 0.05 + i * 0.005; // n0 weakest, n48 strongest
      seedEmbedding(repo, `n${i}.md`, unitVec([align, 1, 0, 0, 0, 0, 0, 0]), "stub");
    }
    const engine = makeEngine({ alpha: queryVec });
    const hits = await hybridSearch(db, {
      query: "alpha",
      limit: 10,
      engine,
      embeddings: repo,
    });
    const top10 = hits.map((h) => h.path);
    // B is FTS-50 but sem-1 → must surface in top 10 via RRF.
    expect(top10).toContain("B.md");
    // FTS top-1 also surfaces → both extremes are kept above the bottom tier.
    const ftsTop = hits.find((h) => h.fts_rank === 1);
    expect(ftsTop).toBeDefined();
    expect(top10).toContain(ftsTop!.path);
  });

  test("proximity boost when focus provided: 1-hop ranks higher than 3-hop", async () => {
    seedNote(db, "focus.md", "F", "alpha");
    seedNote(db, "near.md", "N", "alpha rrfterm");
    seedNote(db, "mid.md", "M", "alpha");
    seedNote(db, "far.md", "Far", "alpha rrfterm");
    seedEdge(db, "focus.md", "near.md");
    seedEdge(db, "near.md", "mid.md");
    seedEdge(db, "mid.md", "far.md");
    const snapshot: GraphSnapshot = {
      generated_at: 0,
      nodes: [
        { id: "focus.md", title: "F", doc_type: null, project: "p", degree: 1, community: null },
        { id: "near.md", title: "N", doc_type: null, project: "p", degree: 2, community: null },
        { id: "mid.md", title: "M", doc_type: null, project: "p", degree: 2, community: null },
        { id: "far.md", title: "Far", doc_type: null, project: "p", degree: 1, community: null },
      ],
      edges: [
        { source: "focus.md", target: "near.md", tier: "mentions", reason: null },
        { source: "near.md", target: "mid.md", tier: "mentions", reason: null },
        { source: "mid.md", target: "far.md", tier: "mentions", reason: null },
      ],
    };
    const hits = await hybridSearch(db, {
      query: "rrfterm",
      focus: "focus.md",
      snapshot,
    });
    const near = hits.find((h) => h.path === "near.md")!;
    const far = hits.find((h) => h.path === "far.md")!;
    expect(near).toBeDefined();
    expect(far).toBeDefined();
    expect(near.hop_distance).toBe(1);
    expect(far.hop_distance).toBe(3);
    expect(near.score).toBeGreaterThan(far.score);
  });

  test("no focus = no proximity boost: ranking matches plain RRF", async () => {
    seedNote(db, "focus.md", "F", "alpha");
    seedNote(db, "near.md", "N", "alpha rrfterm");
    seedNote(db, "far.md", "Far", "alpha rrfterm");
    seedEdge(db, "focus.md", "near.md");
    const snapshot: GraphSnapshot = {
      generated_at: 0,
      nodes: [
        { id: "focus.md", title: "F", doc_type: null, project: "p", degree: 1, community: null },
        { id: "near.md", title: "N", doc_type: null, project: "p", degree: 1, community: null },
        { id: "far.md", title: "Far", doc_type: null, project: "p", degree: 0, community: null },
      ],
      edges: [
        { source: "focus.md", target: "near.md", tier: "mentions", reason: null },
      ],
    };
    const hits = await hybridSearch(db, {
      query: "rrfterm",
      snapshot,
    });
    const near = hits.find((h) => h.path === "near.md")!;
    const far = hits.find((h) => h.path === "far.md")!;
    // No focus → hop_distance stays null on both, and the proximity multiplier
    // is never applied, so the ranking is pure RRF (FTS rank order).
    expect(near.hop_distance).toBe(null);
    expect(far.hop_distance).toBe(null);
    // Plain-RRF score equals 1 / (RRF_K + fts_rank) for each, with no boost.
    const expectNear = 1 / (60 + (near.fts_rank ?? 1));
    const expectFar = 1 / (60 + (far.fts_rank ?? 2));
    expect(Math.abs(near.score - expectNear)).toBeLessThan(1e-9);
    expect(Math.abs(far.score - expectFar)).toBeLessThan(1e-9);
  });

  test("edge_reason hit (G4 regression): both endpoints surface", async () => {
    const aId = seedNote(db, "p.md", "P", "p body");
    const bId = seedNote(db, "q.md", "Q", "q body");
    // Refresh FTS rows so edge_reasons column is populated for both endpoints.
    db.query(
      `UPDATE notes_fts SET edge_reasons = ? WHERE rowid = ?`,
    ).run("compares to graphify", aId);
    db.query(
      `UPDATE notes_fts SET edge_reasons = ? WHERE rowid = ?`,
    ).run("compares to graphify", bId);
    const hits = await hybridSearch(db, { query: "graphify" });
    const paths = hits.map((h) => h.path);
    expect(paths).toContain("p.md");
    expect(paths).toContain("q.md");
  });
});
