import { test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initSchema } from "../../src/server/db";
import { Router } from "../../src/server/router";
import { FileManager } from "../../src/server/file-manager";
import { syncRoutes } from "../../src/server/api/sync";
import { SyncHttpError, type HubClient } from "../../src/server/sync/hub-client";

test("sync_state has a base_content column after initSchema", () => {
  const db = new Database(":memory:");
  initSchema(db);
  const cols = db.query("PRAGMA table_info(sync_state)").all() as { name: string }[];
  expect(cols.map((c) => c.name)).toContain("base_content");
});

test("base_content migration is idempotent on a legacy sync_state", () => {
  const db = new Database(":memory:");
  db.run(`CREATE TABLE sync_state (note_path TEXT PRIMARY KEY, base_hash TEXT NOT NULL, synced_at INTEGER NOT NULL)`);
  initSchema(db); // must ALTER, not throw
  initSchema(db); // run twice — still must not throw
  const cols = db.query("PRAGMA table_info(sync_state)").all() as { name: string }[];
  expect(cols.map((c) => c.name)).toContain("base_content");
});

// ── Task 7: HTTP endpoint tests ──────────────────────────────────────────────

function setup(notes: { rel: string; body: string }[]) {
  const vault = mkdtempSync(join(tmpdir(), "sync-ui-ep-"));
  for (const n of notes) {
    mkdirSync(join(vault, n.rel, ".."), { recursive: true });
    writeFileSync(join(vault, n.rel), `---\ntitle: T\n---\n${n.body}`);
  }
  const db = new Database(":memory:");
  initSchema(db);
  const fm = new FileManager(vault, join(vault, ".scrypt"));
  const router = new Router();
  return { vault, db, fm, router };
}

test("GET /api/sync/local-status returns not-pushed notes with no hub needed", async () => {
  const { vault, db, fm, router } = setup([{ rel: "projects/p/notes/a.md", body: "x" }]);
  syncRoutes(router, db, vault, fm); // no makeHub → hub routes degrade, local-status still works
  const res = await router.handle(new Request("http://localhost/api/sync/local-status"))!;
  expect(res.status).toBe(200);
  const body = await res.json() as { notPushed: string[] };
  expect(body.notPushed).toContain("projects/p/notes/a.md");
  rmSync(vault, { recursive: true, force: true });
});

test("GET /api/sync/status reports hub_not_configured (distinct from hub_unreachable) when no hub URL is set", async () => {
  const { vault, db, fm, router } = setup([]);
  delete process.env.HUB_URL;
  delete process.env.SCRYPT_HUB_URL;
  syncRoutes(router, db, vault, fm);
  const res = await router.handle(new Request("http://localhost/api/sync/status"))!;
  const body = await res.json() as { ok: boolean; error?: string };
  // F1/F16: an unset hub URL is a config gap, surfaced distinctly so the UI can
  // say "hub URL not configured" instead of a misleading network "hub_unreachable".
  expect(body).toEqual({ ok: false, error: "hub_not_configured" });
  rmSync(vault, { recursive: true, force: true });
});

test("GET /api/sync/status returns counts from an injected hub", async () => {
  const { vault, db, fm, router } = setup([{ rel: "projects/p/notes/local.md", body: "L" }]);
  process.env.HUB_URL = "http://hub.invalid";
  const hub = { async getManifest() { return new Map([["projects/p/notes/hub.md", "rh"]]); }, async getNoteContent() { return ""; }, async createNote() {}, async rescanSimilarity() {}, async get() { return new Response(); } } as unknown as HubClient;
  syncRoutes(router, db, vault, fm, () => hub);
  const res = await router.handle(new Request("http://localhost/api/sync/status"))!;
  const body = await res.json() as { ok: boolean; counts: { push: number; pull: number } };
  expect(body.ok).toBe(true);
  expect(body.counts.push).toBe(1);
  expect(body.counts.pull).toBe(1);
  delete process.env.HUB_URL;
  rmSync(vault, { recursive: true, force: true });
});

test("GET /api/sync/diff returns 409 when local equals remote", async () => {
  const { vault, db, fm, router } = setup([{ rel: "projects/p/notes/v.md", body: "same" }]);
  process.env.HUB_URL = "http://hub.invalid";
  const same = "---\ntitle: T\n---\nsame";
  const hub = { async getNoteContent() { return same; }, async getManifest() { return new Map(); }, async createNote() {}, async rescanSimilarity() {}, async get() { return new Response(); } } as unknown as HubClient;
  syncRoutes(router, db, vault, fm, () => hub);
  const res = await router.handle(new Request("http://localhost/api/sync/diff?path=projects/p/notes/v.md"))!;
  expect(res.status).toBe(409);
  delete process.env.HUB_URL;
  rmSync(vault, { recursive: true, force: true });
});

test("GET /api/sync/diff rejects path traversal", async () => {
  const { vault, db, fm, router } = setup([]);
  process.env.HUB_URL = "http://hub.invalid";
  syncRoutes(router, db, vault, fm, () => ({} as unknown as HubClient));
  const res = await router.handle(new Request("http://localhost/api/sync/diff?path=../../etc/passwd"))!;
  expect(res.status).toBe(400);
  delete process.env.HUB_URL;
  rmSync(vault, { recursive: true, force: true });
});

// ── F19: POST /api/sync/sync route wrapper (success payload shape) ───────────

// Minimal injected hub. Overrides let each test steer one method (e.g. make
// getManifest throw a 401) while the rest stay no-op so runSync/resolveClash
// don't blow up on the unrelated calls.
function fakeHub(over: Partial<HubClient> = {}): HubClient {
  return {
    async getManifest() { return new Map<string, string>(); },
    async getNoteContent() { return ""; },
    async createNote() {},
    async rescanSimilarity() {},
    async get() { return new Response(); },
    ...over,
  } as unknown as HubClient;
}

function postReq(path: string, body: unknown): Request {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("POST /api/sync/sync returns the full result payload shape from an injected hub", async () => {
  const { vault, db, fm, router } = setup([{ rel: "projects/p/notes/local.md", body: "L" }]);
  process.env.HUB_URL = "http://hub.invalid";
  // Hub manifest is empty, so the one local note is classified toPush and the
  // route should report pushed=1 with the documented shape.
  syncRoutes(router, db, vault, fm, () => fakeHub());
  const res = await router.handle(postReq("/api/sync/sync", {}))!;
  expect(res.status).toBe(200);
  const body = await res.json() as {
    ok: boolean; pushed: number; pulled: number; clashes: number; failed: string[]; checkedAt: number;
  };
  expect(body.ok).toBe(true);
  expect(body.pushed).toBe(1);
  expect(body.pulled).toBe(0);
  expect(body.clashes).toBe(0);
  expect(Array.isArray(body.failed)).toBe(true);
  expect(typeof body.checkedAt).toBe("number");
  delete process.env.HUB_URL;
  rmSync(vault, { recursive: true, force: true });
});

test("POST /api/sync/sync returns hub_not_configured (not hub_unreachable) when no hub URL is set", async () => {
  const { vault, db, fm, router } = setup([]);
  delete process.env.HUB_URL;
  delete process.env.SCRYPT_HUB_URL;
  syncRoutes(router, db, vault, fm);
  const res = await router.handle(postReq("/api/sync/sync", {}))!;
  const body = await res.json() as { ok: boolean; error?: string };
  expect(body).toEqual({ ok: false, error: "hub_not_configured" });
  rmSync(vault, { recursive: true, force: true });
});

// ── F11: POST /api/sync/resolve 409 already-resolved / stale clash ───────────

test("POST /api/sync/resolve returns 409 already_resolved when local already equals remote", async () => {
  const { vault, db, fm, router } = setup([{ rel: "projects/p/notes/v.md", body: "same" }]);
  process.env.HUB_URL = "http://hub.invalid";
  const same = "---\ntitle: T\n---\nsame";
  // Remote == local on disk: the clash was already resolved elsewhere, so the
  // resolve route must surface a distinct 409 instead of writing a merge.
  syncRoutes(router, db, vault, fm, () => fakeHub({ async getNoteContent() { return same; } }));
  const res = await router.handle(postReq("/api/sync/resolve", { path: "projects/p/notes/v.md", content: "anything" }))!;
  expect(res.status).toBe(409);
  const body = await res.json() as { error?: string };
  expect(body.error).toBe("already_resolved");
  delete process.env.HUB_URL;
  rmSync(vault, { recursive: true, force: true });
});

test("POST /api/sync/resolve writes the merge and returns {ok:true} when local differs from remote", async () => {
  const { vault, db, fm, router } = setup([{ rel: "projects/p/notes/v.md", body: "local-side" }]);
  process.env.HUB_URL = "http://hub.invalid";
  let resolved: { path: string; content: string } | null = null;
  const hub = fakeHub({
    async getNoteContent() { return "---\ntitle: T\n---\nremote-side"; },
    async createNote(path: string, content: string) { resolved = { path, content }; },
  });
  syncRoutes(router, db, vault, fm, () => hub);
  const res = await router.handle(postReq("/api/sync/resolve", { path: "projects/p/notes/v.md", content: "MERGED" }))!;
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true });
  // resolveClash pushed the merged content to the hub.
  expect(resolved).not.toBeNull();
  expect(resolved!.content).toBe("MERGED");
  delete process.env.HUB_URL;
  rmSync(vault, { recursive: true, force: true });
});

// ── F19: POST /api/sync/resolve 400 bad-payload guards ───────────────────────

test("POST /api/sync/resolve returns 400 when path is missing", async () => {
  const { vault, db, fm, router } = setup([]);
  process.env.HUB_URL = "http://hub.invalid";
  syncRoutes(router, db, vault, fm, () => fakeHub());
  const res = await router.handle(postReq("/api/sync/resolve", { content: "x" }))!;
  expect(res.status).toBe(400);
  delete process.env.HUB_URL;
  rmSync(vault, { recursive: true, force: true });
});

test("POST /api/sync/resolve returns 400 when content is not a string", async () => {
  const { vault, db, fm, router } = setup([]);
  process.env.HUB_URL = "http://hub.invalid";
  syncRoutes(router, db, vault, fm, () => fakeHub());
  const res = await router.handle(postReq("/api/sync/resolve", { path: "projects/p/notes/v.md", content: 42 }))!;
  expect(res.status).toBe(400);
  delete process.env.HUB_URL;
  rmSync(vault, { recursive: true, force: true });
});

test("POST /api/sync/resolve returns 400 on a non-JSON body", async () => {
  const { vault, db, fm, router } = setup([]);
  process.env.HUB_URL = "http://hub.invalid";
  syncRoutes(router, db, vault, fm, () => fakeHub());
  const req = new Request("http://localhost/api/sync/resolve", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "}{ not json",
  });
  const res = await router.handle(req)!;
  expect(res.status).toBe(400);
  delete process.env.HUB_URL;
  rmSync(vault, { recursive: true, force: true });
});

test("POST /api/sync/resolve rejects path traversal with 400", async () => {
  const { vault, db, fm, router } = setup([]);
  process.env.HUB_URL = "http://hub.invalid";
  syncRoutes(router, db, vault, fm, () => fakeHub());
  const res = await router.handle(postReq("/api/sync/resolve", { path: "../../etc/passwd", content: "x" }))!;
  expect(res.status).toBe(400);
  delete process.env.HUB_URL;
  rmSync(vault, { recursive: true, force: true });
});

// ── F16: upstream failures surface distinctly, not as blanket hub_unreachable ─

test("POST /api/sync/sync surfaces 'unauthorized' (not hub_unreachable) on a 401 from the hub", async () => {
  const { vault, db, fm, router } = setup([{ rel: "projects/p/notes/local.md", body: "L" }]);
  process.env.HUB_URL = "http://hub.invalid";
  const hub = fakeHub({
    async getManifest(): Promise<Map<string, string>> {
      throw new SyncHttpError("/api/sync/manifest", 401, "http://hub.invalid");
    },
  });
  syncRoutes(router, db, vault, fm, () => hub);
  const res = await router.handle(postReq("/api/sync/sync", {}))!;
  const body = await res.json() as { ok: boolean; error?: string };
  expect(body).toEqual({ ok: false, error: "unauthorized" });
  delete process.env.HUB_URL;
  rmSync(vault, { recursive: true, force: true });
});

test("POST /api/sync/sync surfaces 'bad_manifest' on an unexpected manifest shape error", async () => {
  const { vault, db, fm, router } = setup([{ rel: "projects/p/notes/local.md", body: "L" }]);
  process.env.HUB_URL = "http://hub.invalid";
  const hub = fakeHub({
    async getManifest(): Promise<Map<string, string>> {
      throw new Error("Unexpected manifest shape from http://hub.invalid/api/sync/manifest");
    },
  });
  syncRoutes(router, db, vault, fm, () => hub);
  const res = await router.handle(postReq("/api/sync/sync", {}))!;
  const body = await res.json() as { ok: boolean; error?: string };
  expect(body).toEqual({ ok: false, error: "bad_manifest" });
  delete process.env.HUB_URL;
  rmSync(vault, { recursive: true, force: true });
});

test("POST /api/sync/sync stays 'hub_unreachable' on a genuine network throw", async () => {
  const { vault, db, fm, router } = setup([{ rel: "projects/p/notes/local.md", body: "L" }]);
  process.env.HUB_URL = "http://hub.invalid";
  const hub = fakeHub({
    async getManifest(): Promise<Map<string, string>> {
      throw new Error("online vault unreachable at http://hub.invalid — is Tailscale up?");
    },
  });
  syncRoutes(router, db, vault, fm, () => hub);
  const res = await router.handle(postReq("/api/sync/sync", {}))!;
  const body = await res.json() as { ok: boolean; error?: string };
  expect(body).toEqual({ ok: false, error: "hub_unreachable" });
  delete process.env.HUB_URL;
  rmSync(vault, { recursive: true, force: true });
});

test("POST /api/sync/resolve surfaces 'unauthorized' on a 401 while fetching remote", async () => {
  const { vault, db, fm, router } = setup([{ rel: "projects/p/notes/v.md", body: "local-side" }]);
  process.env.HUB_URL = "http://hub.invalid";
  const hub = fakeHub({
    async getNoteContent(): Promise<string> {
      throw new SyncHttpError("/api/sync/note", 401, "http://hub.invalid");
    },
  });
  syncRoutes(router, db, vault, fm, () => hub);
  const res = await router.handle(postReq("/api/sync/resolve", { path: "projects/p/notes/v.md", content: "M" }))!;
  const body = await res.json() as { ok: boolean; error?: string };
  expect(body).toEqual({ ok: false, error: "unauthorized" });
  delete process.env.HUB_URL;
  rmSync(vault, { recursive: true, force: true });
});

test("GET /api/sync/status surfaces 'unauthorized' on a 401 rather than hub_unreachable", async () => {
  const { vault, db, fm, router } = setup([]);
  process.env.HUB_URL = "http://hub.invalid";
  const hub = fakeHub({
    async getManifest(): Promise<Map<string, string>> {
      throw new SyncHttpError("/api/sync/manifest", 401, "http://hub.invalid");
    },
  });
  syncRoutes(router, db, vault, fm, () => hub);
  const res = await router.handle(new Request("http://localhost/api/sync/status"))!;
  const body = await res.json() as { ok: boolean; error?: string };
  expect(body).toEqual({ ok: false, error: "unauthorized" });
  delete process.env.HUB_URL;
  rmSync(vault, { recursive: true, force: true });
});
