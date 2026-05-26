// src/server/api/sync.ts
//
// Read-only endpoints the sync engine calls on a scrypt server (local or
// hub). Both are under /api/ so the global checkAuth gate protects them
// for remote callers and bypasses for localhost.
import type { Router } from "../router";
import type { Database } from "bun:sqlite";
import { resolve, sep } from "node:path";
import { realpathSync } from "node:fs";
import type { FileManager } from "../file-manager";
import { HubClient } from "../sync/hub-client";
import { runStatus, runSync, runLocalStatus, resolveClash } from "../sync/engine";
import { getBase } from "../sync/state";
import { threeWayMerge } from "../sync/merge";

export type HubFactory = (baseUrl: string, token?: string) => HubClient;

export function syncRoutes(
  router: Router,
  db: Database,
  vaultPath: string,
  fm: FileManager,
  makeHub: HubFactory = (u, t) => new HubClient(u, t),
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
    // Symlink guard: canonicalize and re-check the real target stays in-vault.
    const realRoot = realpathSync(root);
    const realAbs = realpathSync(abs);
    if (realAbs !== realRoot && !realAbs.startsWith(realRoot + sep)) {
      return Response.json({ error: "invalid path" }, { status: 400 });
    }
    return new Response(await file.text(), {
      headers: { "content-type": "text/markdown; charset=utf-8" },
    });
  });

  const guard = (rel: string | null): { abs: string } | { error: Response } => {
    if (!rel) return { error: Response.json({ error: "missing path" }, { status: 400 }) };
    const root = resolve(vaultPath);
    const abs = resolve(root, rel);
    if (!abs.startsWith(root + sep)) return { error: Response.json({ error: "invalid path" }, { status: 400 }) };
    return { abs };
  };

  const buildDeps = (req: Request) => {
    const hubUrl = process.env.HUB_URL;
    if (!hubUrl) return null;
    const token = process.env.SCRYPT_AUTH_TOKEN ?? process.env.AUTH_TOKEN;
    return { db, fm, vaultPath, remote: makeHub(hubUrl, token), local: makeHub(new URL(req.url).origin, token) };
  };

  router.get("/api/sync/local-status", async () => {
    const { notPushed } = await runLocalStatus(db, fm);
    return Response.json({ notPushed });
  });

  router.get("/api/sync/status", async (req) => {
    const deps = buildDeps(req);
    if (!deps) return Response.json({ ok: false, error: "hub_unreachable" });
    try {
      const plan = await runStatus(deps);
      const notPushed = plan.toPush.map((i) => i.path);
      const clashes = plan.clashes.map((i) => i.path);
      const toPull = plan.toPull.map((i) => i.path);
      const removedOnHub = plan.skipped.filter((i) => i.reason === "removed_on_hub").map((i) => i.path);
      return Response.json({ ok: true, checkedAt: Date.now(), counts: { push: notPushed.length, pull: toPull.length, clash: clashes.length }, notPushed, clashes, toPull, removedOnHub });
    } catch { return Response.json({ ok: false, error: "hub_unreachable" }); }
  });

  router.get("/api/sync/diff", async (req) => {
    const rel = new URL(req.url).searchParams.get("path");
    const g = guard(rel); if ("error" in g) return g.error;
    const deps = buildDeps(req);
    if (!deps) return Response.json({ ok: false, error: "hub_unreachable" });
    let remoteText: string;
    try { remoteText = await deps.remote.getNoteContent(rel!); } catch { return Response.json({ ok: false, error: "hub_unreachable" }); }
    const localText = await Bun.file(g.abs).text().catch(() => "");
    if (localText === remoteText) return Response.json({ error: "no_diff" }, { status: 409 });
    const baseRow = getBase(db, rel!);
    const regions = threeWayMerge(baseRow?.content ?? null, localText, remoteText);
    return Response.json({ path: rel, regions });
  });

  router.post("/api/sync/sync", async (req) => {
    const deps = buildDeps(req);
    if (!deps) return Response.json({ ok: false, error: "hub_unreachable" });
    try {
      const r = await runSync(deps);
      return Response.json({ ok: true, pushed: r.pushed.length, pulled: r.pulled.length, clashes: r.clashes.length, failed: r.failed.map((f) => f.path), checkedAt: Date.now() });
    } catch { return Response.json({ ok: false, error: "hub_unreachable" }); }
  });

  router.post("/api/sync/resolve", async (req) => {
    const body = await req.json().catch(() => null) as { path?: string; content?: string } | null;
    if (!body?.path || typeof body.content !== "string") return Response.json({ error: "bad request" }, { status: 400 });
    const g = guard(body.path); if ("error" in g) return g.error;
    const deps = buildDeps(req);
    if (!deps) return Response.json({ ok: false, error: "hub_unreachable" });
    let remoteText: string;
    try { remoteText = await deps.remote.getNoteContent(body.path); } catch { return Response.json({ ok: false, error: "hub_unreachable" }); }
    const localText = await Bun.file(g.abs).text().catch(() => "");
    if (localText === remoteText) return Response.json({ error: "no_conflict" }, { status: 409 });
    try { await resolveClash(deps, body.path, body.content); } catch { return Response.json({ ok: false, error: "hub_unreachable" }); }
    return Response.json({ ok: true });
  });
}
