// src/server/embeddings/search.ts
//
// Pure cosine search over a slice of chunk rows. No I/O: the caller
// (semantic_search / find_similar tools) is responsible for loading
// rows from ChunkEmbeddingsRepo.scanAll and passing them in.
import type { ChunkEmbeddingRow } from "./chunks-repo";

interface ChunkHit {
  note_path: string;
  chunk_id: string;
  chunk_text: string;
  start_line: number;
  end_line: number;
  score: number;
}

type GroupedHit = ChunkHit;

interface SearchOpts {
  limit: number;
  minScore: number;
}

function dot(a: Float32Array, b: Float32Array): number {
  let s = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) s += a[i] * b[i];
  return s;
}

export function searchChunks(
  query: Float32Array,
  rows: ChunkEmbeddingRow[],
  opts: SearchOpts,
): ChunkHit[] {
  const hits: ChunkHit[] = [];
  for (const r of rows) {
    const score = dot(query, r.vector);
    if (score < opts.minScore) continue;
    hits.push({
      note_path: r.note_path,
      chunk_id: r.chunk_id,
      chunk_text: r.chunk_text,
      start_line: r.start_line,
      end_line: r.end_line,
      score,
    });
  }
  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, opts.limit);
}

export function groupByNote(hits: ChunkHit[], limit: number): GroupedHit[] {
  const byNote = new Map<string, GroupedHit>();
  // Journal entries are temporal: each `journal/<date>.md` chunk is its own
  // timestamped thought, so collapsing to one-per-note would hide every entry
  // but the best-scoring one. Keep journal chunks entry-granular; collapse
  // every other note to its single best chunk.
  const perEntry: GroupedHit[] = [];
  for (const h of hits) {
    if (h.note_path.startsWith("journal/")) {
      perEntry.push({ ...h });
      continue;
    }
    const existing = byNote.get(h.note_path);
    if (!existing || h.score > existing.score) {
      byNote.set(h.note_path, { ...h });
    }
  }
  return [...byNote.values(), ...perEntry]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
