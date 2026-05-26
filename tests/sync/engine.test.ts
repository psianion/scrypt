import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { initSchema } from "../../src/server/db";
import { FileManager } from "../../src/server/file-manager";
import { computeContentHash } from "../../src/server/sync/content-hash";
import { setBase, loadBase } from "../../src/server/sync/state";
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

function fakeHub(store: Map<string, string>) {
  return {
    created: [] as { path: string; content: string; tag: string }[],
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
  };
}

beforeEach(() => {
  vaultDir = mkdtempSync(join(tmpdir(), "sync-eng-"));
  mkdirSync(join(vaultDir, ".scrypt"), { recursive: true });
  db = new Database(":memory:");
  initSchema(db);
  fm = new FileManager(vaultDir, join(vaultDir, ".scrypt"));
});

afterEach(() => rmSync(vaultDir, { recursive: true, force: true }));

test("status reports a brand-new local note as push_new", async () => {
  writeNote("a.md", "hello");
  const remote = fakeHub(new Map());
  const local = fakeHub(new Map());
  const deps: SyncDeps = { db, fm, vaultPath: vaultDir, remote: remote as any, local: local as any };
  const plan = await runStatus(deps);
  expect(plan.toPush.map((i) => i.path)).toEqual(["a.md"]);
});

test("push uploads new local notes and records base", async () => {
  writeNote("a.md", "hello");
  const remote = fakeHub(new Map());
  const local = fakeHub(new Map());
  const deps: SyncDeps = { db, fm, vaultPath: vaultDir, remote: remote as any, local: local as any };
  const result = await runPush(deps);
  expect(result.pushed).toEqual(["a.md"]);
  expect(remote.created[0].content).toBe("hello");
  expect(loadBase(db).has("a.md")).toBe(true);
});

test("push never deletes: a note removed on the hub is skipped", async () => {
  writeNote("a.md", "hello");
  setBase(db, "a.md", hashRaw("hello"));
  const remote = fakeHub(new Map());
  const local = fakeHub(new Map());
  const deps: SyncDeps = { db, fm, vaultPath: vaultDir, remote: remote as any, local: local as any };
  const result = await runPush(deps);
  expect(result.pushed).toEqual([]);
  expect(result.skipped).toContain("a.md");
  expect(remote.created).toEqual([]);
});

test("pull applies a new remote note via the local server and records base", async () => {
  const remote = fakeHub(new Map([["b.md", "remote-body"]]));
  const local = fakeHub(new Map());
  const deps: SyncDeps = { db, fm, vaultPath: vaultDir, remote: remote as any, local: local as any };
  const result = await runPull(deps);
  expect(result.pulled).toEqual(["b.md"]);
  expect(local.created[0]).toMatchObject({ path: "b.md", content: "remote-body" });
  expect(loadBase(db).get("b.md")).toBe(hashRaw("remote-body"));
});

test("clash is reported and neither side is written", async () => {
  writeNote("a.md", "local-edit");
  setBase(db, "a.md", hashRaw("base"));
  const remote = fakeHub(new Map([["a.md", "remote-edit"]]));
  const local = fakeHub(new Map());
  const deps: SyncDeps = { db, fm, vaultPath: vaultDir, remote: remote as any, local: local as any };
  const push = await runPush(deps);
  expect(push.clashes).toContain("a.md");
  expect(push.pushed).toEqual([]);
  expect(remote.created).toEqual([]);
});

test("a per-note push failure is recorded in failed and does not abort other notes", async () => {
  writeNote("ok.md", "fine");
  writeNote("bad.md", "boom");
  const remote = {
    created: [] as { path: string; content: string; tag: string }[],
    async getManifest() {
      return new Map<string, string>();
    },
    async getNoteContent() {
      return "";
    },
    async createNote(p: string, content: string, tag: string) {
      if (p === "bad.md") throw new Error("server rejected");
      this.created.push({ path: p, content, tag });
    },
  };
  const local = fakeHub(new Map());
  const deps: SyncDeps = { db, fm, vaultPath: vaultDir, remote: remote as any, local: local as any };
  const result = await runPush(deps);
  expect(result.pushed).toContain("ok.md");
  expect(result.failed.map((f) => f.path)).toContain("bad.md");
  expect(result.failed.find((f) => f.path === "bad.md")!.error).toMatch(/server rejected/);
});
