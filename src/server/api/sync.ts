// src/server/api/sync.ts
//
// Read-only endpoints the sync engine calls on a scrypt server (local or
// hub). Both are under /api/ so the global checkAuth gate protects them
// for remote callers and bypasses for localhost.
import type { Router } from "../router";
import type { Database } from "bun:sqlite";
import { join, normalize } from "node:path";

export function syncRoutes(
  router: Router,
  db: Database,
  vaultPath: string,
): void {
  router.get("/api/sync/manifest", () => {
    const rows = db
      .query(
        `SELECT note_path AS path, content_hash AS hash
         FROM graph_nodes
         WHERE kind = 'note' AND note_path IS NOT NULL AND content_hash IS NOT NULL`,
      )
      .all() as { path: string; hash: string }[];
    return Response.json({
      notes: rows.map((r) => ({ path: r.path, content_hash: r.hash })),
    });
  });

  router.get("/api/sync/note", async (req) => {
    const url = new URL(req.url);
    const rel = url.searchParams.get("path");
    if (!rel) return Response.json({ error: "missing path" }, { status: 400 });
    // Reject traversal: normalized path must stay inside the vault.
    const normalized = normalize(rel);
    if (normalized.startsWith("..") || normalized.includes(`..${"/"}`)) {
      return Response.json({ error: "invalid path" }, { status: 400 });
    }
    const file = Bun.file(join(vaultPath, normalized));
    if (!(await file.exists())) {
      return Response.json({ error: "not found" }, { status: 404 });
    }
    return new Response(await file.text(), {
      headers: { "content-type": "text/markdown; charset=utf-8" },
    });
  });
}
