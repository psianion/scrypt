// src/server/journal/related.ts
import type { Indexer } from "../indexer";
import type { EngineLike } from "../embeddings/service";
import type { ChunkEmbeddingsRepo } from "../embeddings/chunks-repo";
import { searchChunks, groupByNote } from "../embeddings/search";
import type { JournalDoc } from "./doc";

export interface RelatedNote {
  path: string;
  title: string;
  score: number;
}

/**
 * Embedding-based "related notes" for a journal day: embed the day's entry
 * text, find the nearest NON-journal notes. Replaces the old tag/domain
 * matcher + O(vault) disk walk. Read-only suggestions.
 */
export async function buildRelated(
  date: string,
  doc: JournalDoc,
  _indexer: Indexer,
  engine: EngineLike,
  embeddings: ChunkEmbeddingsRepo,
): Promise<RelatedNote[]> {
  const text = doc.entries.map((e) => e.body).join("\n\n").trim();
  if (!text) return [];

  const [vec] = await engine.embedBatch([text]);
  const rows = embeddings.scanAll(engine.model);
  const hits = searchChunks(vec, rows, { limit: 40, minScore: 0.35 }).filter(
    (h) => !h.note_path.startsWith("journal/"),
  );
  const grouped = groupByNote(hits, 5);
  return grouped.map((g) => ({
    path: g.note_path,
    title: g.note_path.split("/").pop()?.replace(/\.md$/, "") ?? g.note_path,
    score: g.score,
  }));
}
