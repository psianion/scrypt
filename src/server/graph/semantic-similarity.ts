// src/server/graph/semantic-similarity.ts
//
// Averages chunk embeddings into a per-note vector and finds pairs whose
// cosine similarity meets the configured threshold. Cosine is off-graph
// (ingestion rework C3): results power search, find_similar, and the
// relatedSuggestions() helper — they are NOT written as graph_edges.
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

export interface RelatedNeighbor {
  path: string;
  score: number;
}

/**
 * Off-graph "related" suggestions: top-N cosine neighbors of `path` using
 * the same per-note averaged + normalized vector as findSimilarPairs.
 * No graph_edges are written — consumed by the index generator and offered
 * to the AI as candidate pairs to type via add_edge. Returns [] if the
 * source note has no embeddings.
 */
export function relatedSuggestions(
  db: Database,
  path: string,
  model: string,
  topN: number,
): RelatedNeighbor[] {
  const rows = db
    .query<ChunkRow, [string]>(
      `SELECT note_path, dims, vector
       FROM note_chunk_embeddings
       WHERE model = ?`,
    )
    .all(model);
  if (rows.length === 0) return [];

  const averaged = averageAndNormalize(rows);
  const source = averaged.find((n) => n.path === path);
  if (!source) return [];

  const scored: RelatedNeighbor[] = [];
  for (const n of averaged) {
    if (n.path === path) continue;
    let score = 0;
    const dims = Math.min(source.vec.length, n.vec.length);
    for (let k = 0; k < dims; k++) score += source.vec[k] * n.vec[k];
    scored.push({ path: n.path, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topN);
}
