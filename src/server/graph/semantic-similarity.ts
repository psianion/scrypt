// src/server/graph/semantic-similarity.ts
//
// Post-batch embedding similarity scan (spec §4.2 step 3).
//
// Averages chunk embeddings into a per-note vector, finds pairs whose
// cosine similarity meets the configured threshold, and writes them as
// `graph_edges.tier = 'semantically_related'` (graph-v2 tier enum).
import type { Database } from "bun:sqlite";

export interface SimilarPair {
  source: string;
  target: string;
  score: number;
}

export interface FindOptions {
  minSimilarity: number;
  /** If set, only emit pairs that include at least one path from this set. */
  scopedTo?: Set<string>;
}

interface ChunkRow {
  note_path: string;
  dims: number;
  vector: Uint8Array;
}

/**
 * Single similarity threshold (graph-v2 G3). Default 0.78; override via
 * `SCRYPT_SIMILARITY_THRESHOLD` env. Clamped to [0, 1]; non-numeric values
 * fall back to the default. Render-side filters were collapsed into this one.
 */
export function getSimilarityThreshold(): number {
  const raw = process.env.SCRYPT_SIMILARITY_THRESHOLD;
  if (raw === undefined || raw === "") return 0.78;
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n)) return 0.78;
  return Math.min(1, Math.max(0, n));
}

function decodeVector(bytes: Uint8Array, dims: number): Float32Array {
  // The blob is stored as the raw byte view of a Float32Array; reconstruct
  // by copying into a fresh ArrayBuffer of the correct size.
  return new Float32Array(new Uint8Array(bytes).buffer.slice(0, dims * 4));
}

interface AveragedNote {
  path: string;
  vec: Float32Array;
}

function averageAndNormalize(rows: ChunkRow[]): AveragedNote[] {
  const acc = new Map<string, { sum: Float32Array; count: number }>();
  for (const row of rows) {
    const vec = decodeVector(row.vector, row.dims);
    let entry = acc.get(row.note_path);
    if (!entry) {
      entry = { sum: new Float32Array(row.dims), count: 0 };
      acc.set(row.note_path, entry);
    }
    for (let k = 0; k < row.dims; k++) entry.sum[k] += vec[k];
    entry.count += 1;
  }

  const out: AveragedNote[] = [];
  for (const [path, entry] of acc) {
    const vec = entry.sum;
    for (let k = 0; k < vec.length; k++) vec[k] /= entry.count;
    let norm = 0;
    for (let k = 0; k < vec.length; k++) norm += vec[k] * vec[k];
    norm = Math.sqrt(norm);
    if (norm > 0) for (let k = 0; k < vec.length; k++) vec[k] /= norm;
    out.push({ path, vec });
  }
  return out;
}

/**
 * Find note-pair similarities above the cosine threshold. Pairs are
 * deduped (only one of (a, b) / (b, a) is emitted, lexicographically
 * smaller path wins as `source`).
 */
export function findSimilarPairs(
  db: Database,
  paths: string[],
  model: string,
  opts: FindOptions,
): SimilarPair[] {
  if (paths.length < 2) return [];

  const placeholders = paths.map(() => "?").join(",");
  const rows = db
    .query<ChunkRow, [string, ...string[]]>(
      `SELECT note_path, dims, vector
       FROM note_chunk_embeddings
       WHERE model = ? AND note_path IN (${placeholders})`,
    )
    .all(model, ...paths);

  if (rows.length === 0) return [];

  const averaged = averageAndNormalize(rows);
  const pairs: SimilarPair[] = [];

  for (let i = 0; i < averaged.length; i++) {
    for (let j = i + 1; j < averaged.length; j++) {
      const a = averaged[i];
      const b = averaged[j];
      if (
        opts.scopedTo &&
        !opts.scopedTo.has(a.path) &&
        !opts.scopedTo.has(b.path)
      ) {
        continue;
      }
      let score = 0;
      const dims = Math.min(a.vec.length, b.vec.length);
      for (let k = 0; k < dims; k++) score += a.vec[k] * b.vec[k];
      if (score < opts.minSimilarity) continue;
      // Stable ordering so a→b and b→a hash to the same UNIQUE key.
      const [source, target] = a.path < b.path ? [a.path, b.path] : [b.path, a.path];
      pairs.push({ source, target, score });
    }
  }

  pairs.sort((p, q) => q.score - p.score);
  return pairs;
}

/**
 * Insert one `graph_edges` row per pair as a `semantically_related` edge.
 * Idempotent — relies on the existing `UNIQUE (source, target, tier)`
 * constraint to skip duplicates. Returns the count of newly inserted rows.
 */
export function upsertSemanticEdges(
  db: Database,
  pairs: SimilarPair[],
): number {
  if (pairs.length === 0) return 0;
  const insert = db.prepare(
    `INSERT OR IGNORE INTO graph_edges
       (source, target, tier, weight, reason, created_at)
     VALUES (?, ?, 'semantically_related', ?, ?, ?)`,
  );
  const now = Date.now();
  let created = 0;
  for (const p of pairs) {
    const reason = `embedding cosine ${p.score.toFixed(3)}`;
    const res = insert.run(p.source, p.target, p.score, reason, now);
    if (res.changes > 0) created += 1;
  }
  return created;
}
