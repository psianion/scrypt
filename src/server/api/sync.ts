// src/server/api/sync.ts
//
// Read-only endpoints the sync engine calls on a scrypt server (local or
// hub). Both are under /api/ so the global checkAuth gate protects them
// for remote callers and bypasses for localhost.
import type { Router } from "../router";
import type { Database } from "bun:sqlite";
import { resolve, sep } from "node:path";

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
    // Resolve against the vault root and require the result to stay inside
    // it. Rejects "../" traversal and absolute paths (e.g. /etc/passwd) alike.
    const root = resolve(vaultPath);
    const abs = resolve(root, rel);
    if (!abs.startsWith(root + sep)) {
      return Response.json({ error: "invalid path" }, { status: 400 });
    }
    const file = Bun.file(abs);
    if (!(await file.exists())) {
      return Response.json({ error: "not found" }, { status: 404 });
    }
    return new Response(await file.text(), {
      headers: { "content-type": "text/markdown; charset=utf-8" },
    });
  });
}
