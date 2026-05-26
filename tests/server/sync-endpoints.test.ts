import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { initSchema } from "../../src/server/db";
import { Router } from "../../src/server/router";
import { syncRoutes } from "../../src/server/api/sync";

let vaultDir: string;
let db: Database;
let router: Router;

beforeEach(() => {
  vaultDir = mkdtempSync(join(tmpdir(), "sync-ep-"));
  db = new Database(":memory:");
  initSchema(db);
  router = new Router();
  syncRoutes(router, db, vaultDir);
});

afterEach(() => {
  rmSync(vaultDir, { recursive: true, force: true });
});

test("manifest returns notes with hashes from graph_nodes", async () => {
  db.run(
    "INSERT INTO graph_nodes (id, kind, note_path, label, content_hash) VALUES (?, 'note', ?, ?, ?)",
    ["projects/p/notes/a.md", "projects/p/notes/a.md", "A", "abc123"],
  );
  const res = await router.handle(
    new Request("http://localhost/api/sync/manifest"),
  )!;
  expect(res.status).toBe(200);
  const body = (await res.json()) as { notes: { path: string; content_hash: string }[] };
  expect(body.notes).toEqual([{ path: "projects/p/notes/a.md", content_hash: "abc123" }]);
});

test("note returns raw markdown for an existing file", async () => {
  mkdirSync(join(vaultDir, "projects/p/notes"), { recursive: true });
  writeFileSync(join(vaultDir, "projects/p/notes/a.md"), "---\ntitle: A\n---\nbody");
  const res = await router.handle(
    new Request("http://localhost/api/sync/note?path=projects/p/notes/a.md"),
  )!;
  expect(res.status).toBe(200);
  expect(await res.text()).toBe("---\ntitle: A\n---\nbody");
});

test("note returns 404 for a missing file", async () => {
  const res = await router.handle(
    new Request("http://localhost/api/sync/note?path=nope.md"),
  )!;
  expect(res.status).toBe(404);
});

test("note rejects path traversal", async () => {
  const res = await router.handle(
    new Request("http://localhost/api/sync/note?path=../../etc/passwd"),
  )!;
  expect(res.status).toBe(400);
});
