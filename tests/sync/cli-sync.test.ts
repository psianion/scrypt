// tests/sync/cli-sync.test.ts
//
// Covers the scrypt-sync CLI (scripts/scrypt-sync.ts) sync path against a FRESH
// DB. The CLI routes schema creation through the canonical initSchema(db) and
// drives status/push/pull via the engine's runStatus/runPush/runPull (same code
// path as the CLI's main()). These tests assert:
//
//   F2: status/push/pull against a fresh initSchema DB must populate
//       base_content and NOT crash. Pre-fix the CLI hand-rolled
//       `CREATE TABLE sync_state (note_path, base_hash, synced_at)` with NO
//       base_content column, so setBase's INSERT threw
//       "table sync_state has no column named base_content" and every item
//       landed in result.failed (CLI exit 1) on every fresh device.
//   F4: push/pull must PERSIST base_content (3-arg setBase with raw), not leave
//       it NULL, so in-app 3-way clash merge has a real base to diff against.
import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { createDatabase, initSchema } from "../../src/server/db";
import { FileManager } from "../../src/server/file-manager";
import { computeContentHash } from "../../src/server/sync/content-hash";
import { getBase, setBase } from "../../src/server/sync/state";
import { runStatus, runPush, runPull, type SyncDeps } from "../../src/server/sync/engine";

let vaultDir: string;
let db: Database;
let fm: FileManager;

function writeNote(rel: string, body: string) {
  const abs = join(vaultDir, rel);
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, body);
}

function hashRaw(raw: string): string {
  return computeContentHash({}, raw);
}

// Mirrors the in-memory hub stub used by engine.test.ts: a content-addressed
// store standing in for both the remote hub and the local server.
function fakeHub(store: Map<string, string>) {
  return {
    created: [] as { path: string; content: string; tag: string }[],
    rescans: [] as string[],
    async getManifest() {
      const map = new Map<string, string>();
      for (const [p, raw] of store) map.set(p, hashRaw(raw));
      return map;
    },
    async getNoteContent(p: string) {
      return store.get(p)!;
    },
    async createNote(p: string, content: string, tag: string) {
      store.set(p, content);
      this.created.push({ path: p, content, tag });
    },
    async rescanSimilarity(tag: string) {
      this.rescans.push(tag);
    },
  };
}

beforeEach(() => {
  vaultDir = mkdtempSync(join(tmpdir(), "cli-sync-"));
  mkdirSync(join(vaultDir, ".scrypt"), { recursive: true });
  fm = new FileManager(vaultDir, join(vaultDir, ".scrypt"));
});

afterEach(() => {
  try {
    db?.close();
  } catch {
    // already closed
  }
  rmSync(vaultDir, { recursive: true, force: true });
});

// The CLI creates its DB exactly like main() does: createDatabase(dbPath) +
// busy_timeout PRAGMA + initSchema(db), under <vault>/.scrypt/scrypt.db. Build
// the SAME thing on disk so we exercise the genuine fresh-device DB, not a
// hand-tuned :memory: one.
function freshCliDb(): Database {
  const dbPath = join(vaultDir, ".scrypt", "scrypt.db");
  const d = createDatabase(dbPath);
  d.run("PRAGMA busy_timeout = 5000");
  initSchema(d);
  return d;
}

// --- F2: fresh-DB schema has base_content, setBase does not crash ---

test("F2: a fresh initSchema sync_state has the base_content column", () => {
  db = freshCliDb();
  const cols = db.query("PRAGMA table_info(sync_state)").all() as { name: string }[];
  expect(cols.map((c) => c.name)).toContain("base_content");
});

test("F2: setBase with content does not throw on a fresh CLI DB", () => {
  db = freshCliDb();
  // Pre-fix this threw "table sync_state has no column named base_content".
  expect(() => setBase(db, "a.md", "h1", "the body")).not.toThrow();
  expect(getBase(db, "a.md")).toMatchObject({ hash: "h1", content: "the body" });
});

// Prove the regression: the CLI's OLD hand-rolled schema (no base_content)
// genuinely makes setBase throw. This is what shipped before F2 and is exactly
// the column the canonical initSchema path above avoids.
test("F2: regression — the pre-fix hand-rolled schema crashes setBase", () => {
  const bad = new Database(":memory:");
  bad.run(
    `CREATE TABLE sync_state (
       note_path TEXT PRIMARY KEY,
       base_hash TEXT NOT NULL,
       synced_at INTEGER NOT NULL
     )`,
  );
  expect(() => setBase(bad, "a.md", "h1", "the body")).toThrow(/base_content/);
  bad.close();
});

// --- F2 + F4: status / push / pull against a FRESH CLI DB ---

test("F2: status against a fresh CLI DB does not crash and plans the push", async () => {
  db = freshCliDb();
  writeNote("a.md", "hello");
  const deps: SyncDeps = {
    db,
    fm,
    vaultPath: vaultDir,
    remote: fakeHub(new Map()) as any,
    local: fakeHub(new Map()) as any,
  };
  const plan = await runStatus(deps);
  expect(plan.toPush.map((i) => i.path)).toEqual(["a.md"]);
});

test("F2+F4: push against a fresh CLI DB succeeds (no failures) and persists base_content", async () => {
  db = freshCliDb();
  writeNote("a.md", "hello world");
  const remote = fakeHub(new Map());
  const deps: SyncDeps = {
    db,
    fm,
    vaultPath: vaultDir,
    remote: remote as any,
    local: fakeHub(new Map()) as any,
  };

  const result = await runPush(deps);

  // F2: nothing in failed — pre-fix every item failed on the base_content INSERT.
  expect(result.failed).toEqual([]);
  expect(result.pushed).toEqual(["a.md"]);
  expect(remote.created[0].content).toBe("hello world");

  // F4: base_content persisted (the 3-arg setBase), not left NULL.
  const base = getBase(db, "a.md");
  expect(base).not.toBeNull();
  expect(base!.hash).toBe(hashRaw("hello world"));
  expect(base!.content).toBe("hello world");
});

test("F2+F4: pull against a fresh CLI DB succeeds (no failures) and persists base_content", async () => {
  db = freshCliDb();
  const remote = fakeHub(new Map([["b.md", "remote-body"]]));
  const local = fakeHub(new Map());
  const deps: SyncDeps = {
    db,
    fm,
    vaultPath: vaultDir,
    remote: remote as any,
    local: local as any,
  };

  const result = await runPull(deps);

  // F2: pull does not crash on the fresh schema.
  expect(result.failed).toEqual([]);
  expect(result.pulled).toEqual(["b.md"]);
  expect(local.created[0]).toMatchObject({ path: "b.md", content: "remote-body" });

  // F4: base_content persisted from the pulled raw bytes.
  const base = getBase(db, "b.md");
  expect(base).not.toBeNull();
  expect(base!.hash).toBe(hashRaw("remote-body"));
  expect(base!.content).toBe("remote-body");
});

test("F4: persisted base_content equals the exact pushed bytes for a multi-line note", async () => {
  db = freshCliDb();
  const body = "---\ntitle: Note\n---\n\nline one\nline two\n";
  writeNote("nested/dir/note.md", body);
  const deps: SyncDeps = {
    db,
    fm,
    vaultPath: vaultDir,
    remote: fakeHub(new Map()) as any,
    local: fakeHub(new Map()) as any,
  };

  const result = await runPush(deps);

  expect(result.failed).toEqual([]);
  expect(result.pushed).toEqual(["nested/dir/note.md"]);
  // 3-way clash merge needs the byte-exact base; assert no truncation/NULL.
  expect(getBase(db, "nested/dir/note.md")!.content).toBe(body);
});

test("F2: push of several notes on a fresh CLI DB records base_content for each", async () => {
  db = freshCliDb();
  writeNote("one.md", "first");
  writeNote("two.md", "second");
  writeNote("three.md", "third");
  const deps: SyncDeps = {
    db,
    fm,
    vaultPath: vaultDir,
    remote: fakeHub(new Map()) as any,
    local: fakeHub(new Map()) as any,
  };

  const result = await runPush(deps);

  expect(result.failed).toEqual([]);
  expect(result.pushed.sort()).toEqual(["one.md", "three.md", "two.md"]);
  for (const [path, body] of [
    ["one.md", "first"],
    ["two.md", "second"],
    ["three.md", "third"],
  ] as const) {
    const base = getBase(db, path);
    expect(base, `base for ${path}`).not.toBeNull();
    expect(base!.content).toBe(body);
  }
});
