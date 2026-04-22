// src/server/api/search.ts
import type { Router } from "../router";
import type { Indexer } from "../indexer";
import type { EngineLike } from "../embeddings/service";
import type { ChunkEmbeddingsRepo } from "../embeddings/chunks-repo";
import { searchChunks, groupByNote } from "../embeddings/search";

export function searchRoutes(
  router: Router,
  indexer: Indexer,
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
