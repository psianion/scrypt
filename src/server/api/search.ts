// src/server/api/search.ts
import type { Router } from "../router";
import type { Indexer } from "../indexer";

export function searchRoutes(router: Router, indexer: Indexer): void {
  router.get("/api/search", (req) => {
    const url = new URL(req.url);
    const q = url.searchParams.get("q") || "";
    if (!q) return Response.json([]);
    const results = indexer.search(q);
    return Response.json(results);
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
