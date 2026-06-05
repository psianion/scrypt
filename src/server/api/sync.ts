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
import { HubClient, SyncHttpError } from "../sync/hub-client";
import { runStatus, runSync, runLocalStatus, resolveClash, type SyncDeps } from "../sync/engine";
import { getBase } from "../sync/state";
import { threeWayMerge } from "../sync/merge";

export type HubFactory = (baseUrl: string, token?: string) => HubClient;

// Cap on note bytes accepted over the read/pull path. A single accidentally
// huge .md (renamed binary, pasted blob) could OOM a small VPS container
// during sync, so we reject anything over this ceiling with a 413.
const MAX_NOTE_BYTES = 25 * 1024 * 1024; // 25 MiB

// One shared path-traversal + symlink guard for every sync endpoint. Resolves
// `rel` against the vault root, rejects "../" traversal and absolute paths via
// a string-prefix check, then canonicalizes (when the target exists) and
// re-checks the real path stays in-vault. The realpath step is try/catched so
// a not-yet-created note doesn't 500 (and never leaks the absolute vault path).
function resolveInsideVault(
  vaultPath: string,
  rel: string | null,
): { abs: string } | { error: Response } {
  if (!rel)
    return { error: Response.json({ error: "missing path" }, { status: 400 }) };
  const root = resolve(vaultPath);
  const abs = resolve(root, rel);
  if (!abs.startsWith(root + sep))
    return { error: Response.json({ error: "invalid path" }, { status: 400 }) };
  try {
    const realRoot = realpathSync(root);
    const realAbs = realpathSync(abs);
    if (realAbs !== realRoot && !realAbs.startsWith(realRoot + sep))
      return {
        error: Response.json({ error: "invalid path" }, { status: 400 }),
      };
  } catch {
    /* target may not exist yet; the string-prefix check above already
       blocked traversal, so an absent file is safe to allow through. */
  }
  return { abs };
}

// Map a raw upstream HubClient error to a distinct, secret-free UI error code.
// SyncHttpError carries the HTTP status (401 => unauthorized); a non-array
// manifest surfaces as the "Unexpected manifest shape" message. Everything
// else (DNS/connection throws, container down, Tailscale off) stays
// "hub_unreachable" so the user can triage the right knob.
function classifyHubError(err: unknown): "unauthorized" | "bad_manifest" | "hub_unreachable" {
  if (err instanceof SyncHttpError) {
    return err.status === 401 ? "unauthorized" : "hub_unreachable";
  }
  if (err instanceof Error && /unexpected manifest shape/i.test(err.message)) {
    return "bad_manifest";
  }
  return "hub_unreachable";
}

export function syncRoutes(
  router: Router,
  db: Database,
  vaultPath: string,
  fm: FileManager,
  makeHub: HubFactory = (u, t) => new HubClient(u, t),
): void {
  router.get("/api/sync/manifest", () => {
    // Exclude _index.md: it is a per-instance derived artifact regenerated on
    // every reindex with a fresh `modified` timestamp. Syncing it would cause
    // perpetual clashes between machines that each regenerate it independently.
    const rows = db
      .query(
        `SELECT note_path AS path, content_hash AS hash
         FROM graph_nodes
         WHERE kind = 'note' AND note_path IS NOT NULL AND content_hash IS NOT NULL
           AND note_path NOT LIKE '%/!_index.md' ESCAPE '!' AND note_path != '_index.md'`,
      )
      .all() as { path: string; hash: string }[];
    return Response.json({
      notes: rows.map((r) => ({ path: r.path, content_hash: r.hash })),
    });
  });

  router.get("/api/sync/note", async (req) => {
    const rel = new URL(req.url).searchParams.get("path");
    const g = resolveInsideVault(vaultPath, rel);
    if ("error" in g) return g.error;
    const file = Bun.file(g.abs);
    if (!(await file.exists())) {
      return Response.json({ error: "not found" }, { status: 404 });
    }
    // Size cap: reject an accidentally-huge note before buffering it into
    // memory, so a single bad file can't OOM the container during sync.
    if (file.size > MAX_NOTE_BYTES) {
      return Response.json({ error: "note_too_large" }, { status: 413 });
    }
    return new Response(await file.text(), {
      headers: { "content-type": "text/markdown; charset=utf-8" },
    });
  });

  // buildDeps reads the hub URL the in-app SyncBar/clash-resolver talk to.
  // Returns one of:
  //   { error: "hub_not_configured" } — no SCRYPT_HUB_URL/HUB_URL set, so the
  //     feature is simply switched off (distinct from a network failure);
  //   deps — a wired SyncDeps when a URL is present.
  const buildDeps = (
    req: Request,
  ): SyncDeps | { error: "hub_not_configured" } => {
    // Standardize on SCRYPT_HUB_URL (shared with the CLI); accept the legacy
    // bare HUB_URL as a fallback for one release. See F6.
    const hubUrl = process.env.SCRYPT_HUB_URL ?? process.env.HUB_URL;
    if (!hubUrl) return { error: "hub_not_configured" };
    const token = process.env.SCRYPT_AUTH_TOKEN ?? process.env.AUTH_TOKEN;
    return { db, fm, vaultPath, remote: makeHub(hubUrl, token), local: makeHub(new URL(req.url).origin, token) };
  };

  router.get("/api/sync/local-status", async () => {
    const { notPushed } = await runLocalStatus(db, fm);
    return Response.json({ notPushed });
  });

  router.get("/api/sync/status", async (req) => {
    const deps = buildDeps(req);
    if ("error" in deps) return Response.json({ ok: false, error: deps.error });
    try {
      const plan = await runStatus(deps);
      const notPushed = plan.toPush.map((i) => i.path);
      const clashes = plan.clashes.map((i) => i.path);
      const toPull = plan.toPull.map((i) => ({ path: i.path, reason: i.reason }));
      const removedOnHub = plan.skipped.filter((i) => i.reason === "removed_on_hub").map((i) => i.path);
      return Response.json({ ok: true, checkedAt: Date.now(), counts: { push: notPushed.length, pull: toPull.length, clash: clashes.length }, notPushed, clashes, toPull, removedOnHub });
    } catch (e) { return Response.json({ ok: false, error: classifyHubError(e) }); }
  });

  router.get("/api/sync/diff", async (req) => {
    const rel = new URL(req.url).searchParams.get("path");
    const g = resolveInsideVault(vaultPath, rel); if ("error" in g) return g.error;
    const deps = buildDeps(req);
    if ("error" in deps) return Response.json({ ok: false, error: deps.error });
    let remoteText: string;
    try { remoteText = await deps.remote.getNoteContent(rel!); } catch (e) { return Response.json({ ok: false, error: classifyHubError(e) }); }
    const localText = await Bun.file(g.abs).text().catch(() => "");
    if (localText === remoteText) return Response.json({ error: "no_diff" }, { status: 409 });
    const baseRow = getBase(db, rel!);
    const regions = threeWayMerge(baseRow?.content ?? null, localText, remoteText);
    return Response.json({ path: rel, regions });
  });

  router.post("/api/sync/sync", async (req) => {
    const deps = buildDeps(req);
    if ("error" in deps) return Response.json({ ok: false, error: deps.error });
    try {
      const r = await runSync(deps);
      return Response.json({ ok: true, pushed: r.pushed.length, pulled: r.pulled.length, clashes: r.clashes.length, failed: r.failed.map((f) => f.path), checkedAt: Date.now() });
    } catch (e) { return Response.json({ ok: false, error: classifyHubError(e) }); }
  });

  router.post("/api/sync/resolve", async (req) => {
    const body = await req.json().catch(() => null) as { path?: string; content?: string } | null;
    if (!body?.path || typeof body.content !== "string") return Response.json({ error: "bad request" }, { status: 400 });
    const g = resolveInsideVault(vaultPath, body.path); if ("error" in g) return g.error;
    const deps = buildDeps(req);
    if ("error" in deps) return Response.json({ ok: false, error: deps.error });
    let remoteText: string;
    try { remoteText = await deps.remote.getNoteContent(body.path); } catch (e) { return Response.json({ ok: false, error: classifyHubError(e) }); }
    const localText = await Bun.file(g.abs).text().catch(() => "");
    // Local and remote already match — the clash was resolved on another
    // device (or never existed). Surface a clear 409 so the resolver can tell
    // the user they're back in sync instead of failing opaquely. (F11)
    if (localText === remoteText) return Response.json({ error: "already_resolved" }, { status: 409 });
    try { await resolveClash(deps, body.path, body.content); } catch (e) { return Response.json({ ok: false, error: classifyHubError(e) }); }
    return Response.json({ ok: true });
  });
}
