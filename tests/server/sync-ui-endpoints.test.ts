import { test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initSchema } from "../../src/server/db";
import { Router } from "../../src/server/router";
import { FileManager } from "../../src/server/file-manager";
import { syncRoutes } from "../../src/server/api/sync";
import type { HubClient } from "../../src/server/sync/hub-client";

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

test("GET /api/sync/status reports hub_unreachable when no HUB_URL is configured", async () => {
  const { vault, db, fm, router } = setup([]);
  delete process.env.HUB_URL;
  syncRoutes(router, db, vault, fm);
  const res = await router.handle(new Request("http://localhost/api/sync/status"))!;
  const body = await res.json() as { ok: boolean; error?: string };
  expect(body).toEqual({ ok: false, error: "hub_unreachable" });
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
