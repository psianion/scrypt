// src/server/api/search.ts
import type { Database } from "bun:sqlite";
import type { Router } from "../router";
import type { Indexer } from "../indexer";
import type { EngineLike } from "../embeddings/service";
import type { ChunkEmbeddingsRepo } from "../embeddings/chunks-repo";
import type { MetadataRepo } from "../indexer/metadata-repo";
import { searchChunks, groupByNote } from "../embeddings/search";
import { hybridSearch } from "../graph/hybrid-search";

export function searchRoutes(
  router: Router,
  indexer: Indexer,
  db: Database,
  metadata: MetadataRepo,
  engine?: EngineLike,
  embeddings?: ChunkEmbeddingsRepo,
): void {
  router.get("/api/search", (req) => {
    const url = new URL(req.url);
    const q = url.searchParams.get("q") || "";
    if (!q) return Response.json([]);
    const results = indexer.search(q);
    return Response.json(results);
  });

  // Graph-specific search: merges FTS5 (title + content) with semantic
  // (embedding cosine) so graph filtering matches notes that mention a term
  // literally *or* are semantically about it. Returns a flat path set.
  router.get("/api/search/graph", async (req) => {
    const url = new URL(req.url);
    const q = url.searchParams.get("q") || "";
    if (!q) return Response.json({ paths: [] });

    const paths = new Set<string>();
    try {
      for (const r of indexer.search(q)) paths.add(r.path);
    } catch {
      // FTS may reject malformed queries; ignore.
    }

    if (engine && embeddings) {
      try {
        const vectors = await engine.embedBatch([q]);
        const rows = embeddings.scanAll(engine.model);
        const hits = searchChunks(vectors[0]!, rows, { limit: 80, minScore: 0.45 });
        const grouped = groupByNote(hits, 20);
        for (const g of grouped) paths.add(g.note_path);
      } catch {
        // Embedder unavailable or model not loaded — fall back to FTS-only.
      }
    }

    return Response.json({ paths: [...paths] });
  });

  // Accuracy-first search for external clients (e.g. Discord bot). Composes
  // the existing hybrid engine (BM25 + embedding cosine via RRF) and enriches
  // each hit with display metadata. Degrades to FTS-only when the embedder is
  // unavailable — hybridSearch handles that internally.
  router.get("/api/search/hybrid", async (req) => {
    const url = new URL(req.url);
    const q = (url.searchParams.get("q") || "").trim();
    if (!q) return Response.json({ query: q, hits: [] });

    const rawLimit = parseInt(url.searchParams.get("limit") || "8", 10);
    const limit = Math.min(Math.max(Number.isFinite(rawLimit) ? rawLimit : 8, 1), 25);

    const ranked = await hybridSearch(db, { query: q, limit, engine, embeddings });

    const noteRow = db.query<
      { project: string | null; doc_type: string | null; content: string | null },
      [string]
    >(
      `SELECT n.project, n.doc_type, f.content
       FROM notes n LEFT JOIN notes_fts f ON f.rowid = n.id
       WHERE n.path = ?`,
    );

    const hits = ranked.map((h) => {
      const note = noteRow.get(h.path);
      const m = metadata.get(h.path);
      // ponytail: excerpt is the first ~200 chars of indexed body, not a
      // match-window snippet; upgrade to fts5 snippet() if relevance matters.
      const excerpt = (note?.content ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
      return {
        path: h.path,
        title: h.title,
        project: note?.project ?? null,
        doc_type: m?.doc_type ?? note?.doc_type ?? null,
        description: m?.description ?? m?.summary ?? null,
        excerpt,
        score: h.score,
        fts_rank: h.fts_rank,
        sem_rank: h.sem_rank,
      };
    });

    return Response.json({ query: q, hits });
  });

  router.get("/api/search/tags", (req) => {
    const url = new URL(req.url);
    const q = (url.searchParams.get("q") || "").toLowerCase();
    const allTags = indexer.getTags();
    const filtered = q
      ? allTags.filter((t) => t.tag.toLowerCase().includes(q))
      : allTags;
    return Response.json(filtered);
  });

  // /api/graph (root) is now owned by graphRoutes — Wave 7 domain-aware shape.
  router.get("/api/graph/*path", (req, params) => {
    const url = new URL(req.url);
    const depth = parseInt(url.searchParams.get("depth") || "2", 10);
    return Response.json(indexer.getLocalGraph(params.path, depth));
  });

  router.get("/api/backlinks/*path", (_req, params) => {
    return Response.json(indexer.getBacklinks(params.path));
  });
}
