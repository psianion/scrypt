import { test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { initSchema } from "../../src/server/db";
import { setBase, getBase } from "../../src/server/sync/state";

function freshDb() { const db = new Database(":memory:"); initSchema(db); return db; }

test("setBase persists hash and content; getBase reads them back", () => {
  const db = freshDb();
  setBase(db, "a.md", "h1", "hello world");
  expect(getBase(db, "a.md")).toEqual({ hash: "h1", content: "hello world" });
});

test("setBase without content stores null content (back-compat)", () => {
  const db = freshDb();
  setBase(db, "b.md", "h2");
  expect(getBase(db, "b.md")).toEqual({ hash: "h2", content: null });
});

test("getBase returns null for an unknown path", () => {
  expect(getBase(freshDb(), "missing.md")).toBeNull();
});

test("setBase upserts content on conflict", () => {
  const db = freshDb();
  setBase(db, "a.md", "h1", "v1");
  setBase(db, "a.md", "h2", "v2");
  expect(getBase(db, "a.md")).toEqual({ hash: "h2", content: "v2" });
});

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileManager } from "../../src/server/file-manager";
import { computeContentHash } from "../../src/server/sync/content-hash";
import { runLocalStatus } from "../../src/server/sync/engine";

function vaultWithNote(rel: string, body: string) {
  const vault = mkdtempSync(join(tmpdir(), "sync-local-"));
  mkdirSync(join(vault, rel, ".."), { recursive: true });
  writeFileSync(join(vault, rel), `---\ntitle: T\n---\n${body}`);
  return vault;
}

test("runLocalStatus flags a note with no base as not pushed", async () => {
  const vault = vaultWithNote("projects/p/notes/a.md", "hello");
  const fm = new FileManager(vault, join(vault, ".scrypt"));
  const db = freshDb();
  const { notPushed } = await runLocalStatus(db, fm);
  expect(notPushed).toContain("projects/p/notes/a.md");
  rmSync(vault, { recursive: true, force: true });
});

test("runLocalStatus ignores a note whose disk hash equals its base", async () => {
  const vault = vaultWithNote("projects/p/notes/a.md", "hello");
  const fm = new FileManager(vault, join(vault, ".scrypt"));
  const db = freshDb();
  const note = await fm.readNote("projects/p/notes/a.md");
  setBase(db, "projects/p/notes/a.md", computeContentHash(note!.frontmatter, note!.content));
  const { notPushed } = await runLocalStatus(db, fm);
  expect(notPushed).not.toContain("projects/p/notes/a.md");
  rmSync(vault, { recursive: true, force: true });
});

import type { HubClient } from "../../src/server/sync/hub-client";
import { runSync } from "../../src/server/sync/engine";

function fakeHub(notes: Map<string, { content: string; hash: string }>) {
  const created: { path: string; content: string }[] = [];
  const hub = {
    async getManifest() { return new Map([...notes].map(([p, v]) => [p, v.hash])); },
    async getNoteContent(p: string) { return notes.get(p)!.content; },
    async createNote(p: string, content: string) { created.push({ path: p, content }); notes.set(p, { content, hash: `h-${content.length}` }); },
    async rescanSimilarity() {},
    async get() { return new Response(); },
  };
  return { hub: hub as unknown as HubClient, created, notes };
}

test("runSync pushes local-only notes and pulls hub-only notes in one pass, skipping clashes", async () => {
  const vault = mkdtempSync(join(tmpdir(), "sync-run-"));
  mkdirSync(join(vault, "projects/p/notes"), { recursive: true });
  writeFileSync(join(vault, "projects/p/notes/local.md"), "---\ntitle: L\n---\nlocal body");
  const fm = new FileManager(vault, join(vault, ".scrypt"));
  const db = freshDb();

  const remote = fakeHub(new Map([["projects/p/notes/hub.md", { content: "---\ntitle: H\n---\nhub body", hash: "rh" }]]));
  const local = fakeHub(new Map()); // local writes go through here in the engine

  const result = await runSync({ db, fm, vaultPath: vault, remote: remote.hub, local: local.hub });
  expect(result.pushed).toContain("projects/p/notes/local.md");
  expect(result.pulled).toContain("projects/p/notes/hub.md");
  expect(remote.created.map((c) => c.path)).toContain("projects/p/notes/local.md"); // pushed up
  rmSync(vault, { recursive: true, force: true });
});

import { resolveClash } from "../../src/server/sync/engine";

test("resolveClash writes merged locally, pushes it to the hub, and records merged as base", async () => {
  const vault = mkdtempSync(join(tmpdir(), "sync-resolve-"));
  mkdirSync(join(vault, "projects/p/notes"), { recursive: true });
  writeFileSync(join(vault, "projects/p/notes/v.md"), "---\ntitle: V\n---\nmine");
  const fm = new FileManager(vault, join(vault, ".scrypt"));
  const db = freshDb();

  // local fake actually writes to disk so readNote sees the merged content:
  const localWrites: string[] = [];
  const local = {
    async createNote(p: string, content: string) { await fm.writeNote(p, content); localWrites.push(p); },
    async rescanSimilarity() {}, async getManifest() { return new Map(); }, async getNoteContent() { return ""; }, async get() { return new Response(); },
  } as unknown as HubClient;
  const remote = fakeHub(new Map([["projects/p/notes/v.md", { content: "---\ntitle: V\n---\ntheirs", hash: "rh" }]]));

  const merged = "---\ntitle: V\n---\nmerged result";
  await resolveClash({ db, fm, vaultPath: vault, remote: remote.hub, local }, "projects/p/notes/v.md", merged);

  expect(localWrites).toContain("projects/p/notes/v.md");                 // written locally
  expect(remote.created.map((c) => c.content)).toContain(merged);        // pushed to hub
  const base = getBase(db, "projects/p/notes/v.md");
  expect(base?.content).toBe(merged);                                    // base = merged
  rmSync(vault, { recursive: true, force: true });
});
