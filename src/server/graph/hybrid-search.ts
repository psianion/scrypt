// src/server/graph/hybrid-search.ts
//
// Hybrid graph search: blends BM25 over the wide notes_fts index with
// embedding cosine via Reciprocal Rank Fusion (Cormack et al. 2009, k=60).
// Optional proximity boost multiplies a path's RRF score by 1 + 1/(1 + hops)
// when a focus note is provided; BFS over snapshot edges is capped at depth 3.
import type { Database } from "bun:sqlite";
import type { EngineLike } from "../embeddings/service";
import type { ChunkEmbeddingsRepo } from "../embeddings/chunks-repo";
import { searchChunks, groupByNote } from "../embeddings/search";
import type { GraphSnapshot } from "./snapshot";
import { buildGraphSnapshot } from "./snapshot";

export const RRF_K = 60;
export const PROXIMITY_MAX_HOPS = 3;

export interface HybridHit {
  path: string;
  title: string;
  score: number;
  fts_rank: number | null;
  sem_rank: number | null;
  hop_distance: number | null;
}

export interface HybridSearchOpts {
  query: string;
  limit?: number;
  focus?: string | null;
  snapshot?: GraphSnapshot | null;
  engine?: EngineLike;
  embeddings?: ChunkEmbeddingsRepo;
}

interface FtsRow {
  path: string;
  title: string | null;
  bm25: number;
}

function ftsRanks(db: Database, query: string): Map<string, { rank: number; title: string }> {
  const out = new Map<string, { rank: number; title: string }>();
  let rows: FtsRow[];
  try {
    rows = db
      .query<FtsRow, [string]>(
        `SELECT notes_fts.path AS path,
                COALESCE(n.title, notes_fts.title) AS title,
                bm25(notes_fts) AS bm25
         FROM notes_fts
         LEFT JOIN notes n ON n.id = notes_fts.rowid
         WHERE notes_fts MATCH ?
         ORDER BY bm25(notes_fts) ASC
         LIMIT 50`,
      )
      .all(query);
  } catch {
    return out;
  }
  rows.forEach((r, i) => {
    if (!out.has(r.path)) {
      out.set(r.path, { rank: i + 1, title: r.title ?? r.path });
    }
  });
  return out;
}

async function semanticRanks(
  query: string,
  engine: EngineLike,
  embeddings: ChunkEmbeddingsRepo,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  let vectors: Float32Array[];
  try {
    vectors = await engine.embedBatch([query]);
  } catch {
    return out;
  }
  if (!vectors[0]) return out;
  const rows = embeddings.scanAll(engine.model);
  if (rows.length === 0) return out;
  const hits = searchChunks(vectors[0], rows, { limit: 250, minScore: 0 });
  const grouped = groupByNote(hits, 50);
  grouped.forEach((g, i) => {
    out.set(g.note_path, i + 1);
  });
  return out;
}

function buildAdjacency(snap: GraphSnapshot): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>();
  for (const e of snap.edges) {
    if (!adj.has(e.source)) adj.set(e.source, new Set());
    if (!adj.has(e.target)) adj.set(e.target, new Set());
    adj.get(e.source)!.add(e.target);
    adj.get(e.target)!.add(e.source);
  }
  return adj;
}

function bfsHops(
  start: string,
  adj: Map<string, Set<string>>,
  maxDepth: number,
): Map<string, number> {
  const dist = new Map<string, number>();
  dist.set(start, 0);
  const queue: string[] = [start];
  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++]!;
    const d = dist.get(cur)!;
    if (d >= maxDepth) continue;
    for (const nb of adj.get(cur) ?? []) {
      if (dist.has(nb)) continue;
      dist.set(nb, d + 1);
      queue.push(nb);
    }
  }
  return dist;
}

export async function hybridSearch(
  db: Database,
  opts: HybridSearchOpts,
): Promise<HybridHit[]> {
  const limit = opts.limit ?? 30;
  const q = opts.query.trim();
  if (!q) return [];

  const fts = ftsRanks(db, q);
  const sem =
    opts.engine && opts.embeddings
      ? await semanticRanks(q, opts.engine, opts.embeddings)
      : new Map<string, number>();

  const allPaths = new Set<string>([...fts.keys(), ...sem.keys()]);
  if (allPaths.size === 0) return [];

  let hopMap: Map<string, number> | null = null;
  if (opts.focus) {
    const snap = opts.snapshot ?? buildGraphSnapshot(db);
    const adj = buildAdjacency(snap);
    hopMap = bfsHops(opts.focus, adj, PROXIMITY_MAX_HOPS);
  }

  const titleFor = (path: string): string => {
    const f = fts.get(path);
    if (f) return f.title;
    const r = db
      .query<{ title: string | null }, [string]>(
        `SELECT title FROM notes WHERE path = ?`,
      )
      .get(path);
    return r?.title ?? path;
  };

  const results: HybridHit[] = [];
  for (const path of allPaths) {
    const ftsRank = fts.get(path)?.rank ?? null;
    const semRank = sem.get(path) ?? null;
    const ftsContrib = ftsRank !== null ? 1 / (RRF_K + ftsRank) : 0;
    const semContrib = semRank !== null ? 1 / (RRF_K + semRank) : 0;
    let score = ftsContrib + semContrib;
    let hop: number | null = null;
    if (hopMap) {
      const h = hopMap.get(path);
      if (h !== undefined) {
        hop = h;
        score *= 1 + 1 / (1 + h);
      }
    }
    results.push({
      path,
      title: titleFor(path),
      score,
      fts_rank: ftsRank,
      sem_rank: semRank,
      hop_distance: hop,
    });
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}
