import { test, expect } from "bun:test";
import {
  renderIndexNote,
  type IndexNoteEntry,
} from "../../../src/server/ingest/index-note";

const entries: IndexNoteEntry[] = [
  {
    path: "projects/scrypt/spec/ingest-rework.md",
    title: "Ingestion Rework",
    summary: "Reworks chunking, links, classification.",
    doc_type: "spec",
    related: [],
    links: [],
  },
  {
    path: "projects/scrypt/plan/ingest-plan.md",
    title: "Ingest Plan",
    summary: null,
    doc_type: "plan",
    related: [],
    links: [],
  },
  {
    path: "projects/scrypt/spec/sync-spec.md",
    title: "Sync Spec",
    summary: "Git-style push/pull.",
    doc_type: "spec",
    related: [],
    links: [],
  },
];

test("renders kind:index frontmatter and a do-not-edit header", () => {
  const md = renderIndexNote("scrypt", entries);
  expect(md).toContain("kind: index");
  expect(md).toContain("title: scrypt — index");
  expect(md).toMatch(/<!--\s*GENERATED/i);
  expect(md).toContain("do not edit");
});

test("groups the ToC by doc_type with markdown links and 1-line summaries", () => {
  const md = renderIndexNote("scrypt", entries);
  // doc_type headers present and alphabetically ordered (plan before spec).
  const planIdx = md.indexOf("## plan");
  const specIdx = md.indexOf("## spec");
  expect(planIdx).toBeGreaterThan(-1);
  expect(specIdx).toBeGreaterThan(planIdx);
  // entry link + summary on one line.
  expect(md).toContain(
    "- [Ingestion Rework](spec/ingest-rework.md) — Reworks chunking, links, classification.",
  );
  // null summary degrades gracefully (link only, no trailing dash).
  expect(md).toContain("- [Ingest Plan](plan/ingest-plan.md)");
  expect(md).not.toContain("ingest-plan.md) —");
});

test("a null doc_type lands in an 'other' group that sorts after named groups", () => {
  const withUntyped: IndexNoteEntry[] = [
    {
      path: "projects/scrypt/spec/typed.md",
      title: "Typed",
      summary: null,
      doc_type: "spec",
      related: [],
      links: [],
    },
    {
      path: "projects/scrypt/misc/loose.md",
      title: "Loose",
      summary: null,
      doc_type: null,
      related: [],
      links: [],
    },
  ];
  const md = renderIndexNote("scrypt", withUntyped);
  const specIdx = md.indexOf("## spec");
  const otherIdx = md.indexOf("## other");
  expect(specIdx).toBeGreaterThan(-1);
  expect(otherIdx).toBeGreaterThan(specIdx);
  expect(md).toContain("- [Loose](misc/loose.md)");
});

test("renders a Links section listing each note's meaningful edges", () => {
  const withLinks: IndexNoteEntry[] = [
    {
      path: "projects/scrypt/spec/a.md",
      title: "A",
      summary: "First.",
      doc_type: "spec",
      related: [],
      links: [
        { target: "projects/scrypt/plan/b.md", label: "builds_on" },
        { target: "projects/scrypt/research/c.md", label: "reference" },
      ],
    },
  ];
  const md = renderIndexNote("scrypt", withLinks);
  expect(md).toContain("## Links");
  expect(md).toContain(
    "- **A** builds_on [b](plan/b.md), reference [c](research/c.md)",
  );
});

test("omits the Links section entirely when no note has edges", () => {
  const md = renderIndexNote("scrypt", [
    {
      path: "projects/scrypt/spec/a.md",
      title: "A",
      summary: null,
      doc_type: "spec",
      related: [],
      links: [],
    },
  ]);
  expect(md).not.toContain("## Links");
});

import { Database } from "bun:sqlite";
import { initSchema } from "../../../src/server/db";
import { MetadataRepo } from "../../../src/server/indexer/metadata-repo";
import { collectProjectEntries } from "../../../src/server/ingest/index-note";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileManager } from "../../../src/server/file-manager";
import {
  generateProjectIndex,
  IndexNoteScheduler,
} from "../../../src/server/ingest/index-note";

test("collectProjectEntries gathers notes, summaries, and meaningful edges for a project", () => {
  const db = new Database(":memory:");
  initSchema(db);
  // Two notes in project 'scrypt', one in 'dnd' (must be excluded).
  db.run(
    `INSERT INTO notes (path, title, project, doc_type) VALUES
      ('projects/scrypt/spec/a.md','A','scrypt','spec'),
      ('projects/scrypt/plan/b.md','B','scrypt','plan'),
      ('projects/dnd/research/c.md','C','dnd','research')`,
  );
  // graph_nodes are needed for snapshot joins elsewhere; harmless here.
  db.run(
    `INSERT INTO graph_nodes (id, kind, label, note_path) VALUES
      ('projects/scrypt/spec/a.md','note','A','projects/scrypt/spec/a.md'),
      ('projects/scrypt/plan/b.md','note','B','projects/scrypt/plan/b.md')`,
  );
  // A meaningful edge a -> b at tier 'connected' with a typed reason.
  db.run(
    `INSERT INTO graph_edges (source, target, tier, reason, created_at)
     VALUES ('projects/scrypt/spec/a.md','projects/scrypt/plan/b.md','connected','builds_on',0)`,
  );
  const metadata = new MetadataRepo(db);
  metadata.upsert("projects/scrypt/spec/a.md", { summary: "First spec." });

  const entries = collectProjectEntries({ db, metadata }, "scrypt");
  expect(entries.map((e) => e.path).sort()).toEqual([
    "projects/scrypt/plan/b.md",
    "projects/scrypt/spec/a.md",
  ]);
  const a = entries.find((e) => e.path === "projects/scrypt/spec/a.md")!;
  expect(a.summary).toBe("First spec.");
  expect(a.doc_type).toBe("spec");
  expect(a.links).toEqual([
    { target: "projects/scrypt/plan/b.md", label: "builds_on" },
  ]);
});

test("collectProjectEntries tolerates a graph_edges table without rel_type (label falls back to reason)", () => {
  const db = new Database(":memory:");
  // Minimal raw schema WITHOUT rel_type — exercises the NULL AS rel_type
  // branch (initSchema would always add rel_type via wave11).
  db.run(
    `CREATE TABLE notes (
       id INTEGER PRIMARY KEY, path TEXT UNIQUE NOT NULL, title TEXT,
       project TEXT, doc_type TEXT
     )`,
  );
  db.run(
    `CREATE TABLE graph_edges (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       source TEXT NOT NULL, target TEXT NOT NULL, tier TEXT NOT NULL,
       reason TEXT, created_at INTEGER
     )`,
  );
  db.run(
    `CREATE TABLE note_chunk_embeddings (
       chunk_id TEXT, note_path TEXT, model TEXT, dims INTEGER, vector BLOB
     )`,
  );
  db.run(
    `CREATE TABLE note_metadata (
       note_path TEXT PRIMARY KEY, description TEXT, entities TEXT,
       themes TEXT, doc_type TEXT, summary TEXT, updated_at INTEGER
     )`,
  );
  db.run(
    `INSERT INTO notes (path, title, project, doc_type) VALUES
      ('projects/scrypt/spec/a.md','A','scrypt','spec'),
      ('projects/scrypt/plan/b.md','B','scrypt','plan')`,
  );
  db.run(
    `INSERT INTO graph_edges (source, target, tier, reason, created_at)
     VALUES ('projects/scrypt/spec/a.md','projects/scrypt/plan/b.md','connected','builds_on',0)`,
  );
  const metadata = new MetadataRepo(db);

  const entries = collectProjectEntries({ db, metadata }, "scrypt");
  const a = entries.find((e) => e.path === "projects/scrypt/spec/a.md")!;
  // rel_type column absent → label falls back to reason.
  expect(a.links).toEqual([
    { target: "projects/scrypt/plan/b.md", label: "builds_on" },
  ]);
});

// ---------------------------------------------------------------------------
// Task 28: generateProjectIndex
// ---------------------------------------------------------------------------

test("generateProjectIndex writes _index.md and is byte-stable on re-run (idempotent body)", async () => {
  const vault = mkdtempSync(join(tmpdir(), "rework-idx-"));
  const db = new Database(":memory:");
  initSchema(db);
  db.run(
    `INSERT INTO notes (path, title, project, doc_type) VALUES
      ('projects/scrypt/spec/a.md','A','scrypt','spec'),
      ('projects/scrypt/plan/b.md','B','scrypt','plan')`,
  );
  const metadata = new MetadataRepo(db);
  metadata.upsert("projects/scrypt/spec/a.md", { summary: "First." });
  const fm = new FileManager(vault, join(vault, ".scrypt"));

  const res = await generateProjectIndex({ db, metadata, fm }, "scrypt");
  expect(res.written).toBe(true);
  expect(res.vaultPath).toBe("projects/scrypt/_index.md");
  expect(res.noteCount).toBe(2);

  const raw1 = readFileSync(join(vault, "projects/scrypt/_index.md"), "utf8");
  expect(raw1).toContain("kind: index");
  expect(raw1).toContain("## plan");
  expect(raw1).toContain("[A](spec/a.md) — First.");

  await generateProjectIndex({ db, metadata, fm }, "scrypt");
  const raw2 = readFileSync(join(vault, "projects/scrypt/_index.md"), "utf8");
  const bodyOf = (s: string) => s.slice(s.indexOf("\n---\n", 4) + 5);
  expect(bodyOf(raw2)).toBe(bodyOf(raw1));

  rmSync(vault, { recursive: true, force: true });
});

test("regeneration after a hand edit overwrites it — nothing hand-written survives", async () => {
  const vault = mkdtempSync(join(tmpdir(), "rework-idx2-"));
  const db = new Database(":memory:");
  initSchema(db);
  db.run(
    `INSERT INTO notes (path, title, project, doc_type)
     VALUES ('projects/scrypt/spec/a.md','A','scrypt','spec')`,
  );
  const fm = new FileManager(vault, join(vault, ".scrypt"));
  const metadata = new MetadataRepo(db);
  await generateProjectIndex({ db, metadata, fm }, "scrypt");

  const p = join(vault, "projects/scrypt/_index.md");
  const tampered = readFileSync(p, "utf8") + "\nHAND EDIT\n";
  await Bun.write(p, tampered);
  await generateProjectIndex({ db, metadata, fm }, "scrypt");

  const after = readFileSync(p, "utf8");
  expect(after).not.toContain("HAND EDIT");
  expect(after).toContain("do not edit");
  rmSync(vault, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Task 29: IndexNoteScheduler
// ---------------------------------------------------------------------------

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("IndexNoteScheduler coalesces rapid schedules for the same project into one write", async () => {
  const vault = mkdtempSync(join(tmpdir(), "rework-sched-"));
  const db = new Database(":memory:");
  initSchema(db);
  db.run(
    `INSERT INTO notes (path, title, project, doc_type)
     VALUES ('projects/scrypt/spec/a.md','A','scrypt','spec')`,
  );
  const fm = new FileManager(vault, join(vault, ".scrypt"));
  const metadata = new MetadataRepo(db);
  let writes = 0;
  const sched = new IndexNoteScheduler({ db, metadata, fm }, { debounceMs: 15 });
  sched.onWrite = () => { writes += 1; };
  sched.schedule("scrypt");
  sched.schedule("scrypt");
  sched.schedule("scrypt");
  await wait(200);
  expect(writes).toBe(1);
  expect(readFileSync(join(vault, "projects/scrypt/_index.md"), "utf8")).toContain("kind: index");
  rmSync(vault, { recursive: true, force: true });
});

test("IndexNoteScheduler tracks distinct projects independently", async () => {
  const vault = mkdtempSync(join(tmpdir(), "rework-sched2-"));
  const db = new Database(":memory:");
  initSchema(db);
  db.run(
    `INSERT INTO notes (path, title, project, doc_type) VALUES
      ('projects/scrypt/spec/a.md','A','scrypt','spec'),
      ('projects/dnd/research/c.md','C','dnd','research')`,
  );
  const fm = new FileManager(vault, join(vault, ".scrypt"));
  const metadata = new MetadataRepo(db);
  const sched = new IndexNoteScheduler({ db, metadata, fm }, { debounceMs: 15 });
  sched.schedule("scrypt");
  sched.schedule("dnd");
  await wait(200);
  expect(existsSync(join(vault, "projects/scrypt/_index.md"))).toBe(true);
  expect(existsSync(join(vault, "projects/dnd/_index.md"))).toBe(true);
  rmSync(vault, { recursive: true, force: true });
});

test("IndexNoteScheduler single-flight: a mid-flight schedule chains one follow-up after the first resolves", async () => {
  const vault = mkdtempSync(join(tmpdir(), "rework-sched3-"));
  const db = new Database(":memory:");
  initSchema(db);
  db.run(
    `INSERT INTO notes (path, title, project, doc_type)
     VALUES ('projects/scrypt/spec/a.md','A','scrypt','spec')`,
  );
  const metadata = new MetadataRepo(db);
  // Wrap a real FileManager and make writeNote artificially slow so the first
  // regen is still in flight when we issue the second schedule().
  const realFm = new FileManager(vault, join(vault, ".scrypt"));
  let inFlight = 0;
  let maxConcurrent = 0;
  const order: string[] = [];
  const slowFm = {
    writeNote: async (
      path: string,
      content: string,
      frontmatter?: Record<string, unknown>,
    ) => {
      inFlight += 1;
      maxConcurrent = Math.max(maxConcurrent, inFlight);
      order.push("start");
      await wait(40);
      await realFm.writeNote(path, content, frontmatter);
      order.push("end");
      inFlight -= 1;
    },
  } as unknown as FileManager;

  let writes = 0;
  const sched = new IndexNoteScheduler(
    { db, metadata, fm: slowFm },
    { debounceMs: 5 },
  );
  sched.onWrite = () => { writes += 1; };

  sched.schedule("scrypt");
  // Wait past the debounce so flush() fires and the slow write is in flight.
  await wait(20);
  expect(inFlight).toBe(1);
  // Mid-flight schedule → must land on the pending path, not start a 2nd write.
  sched.schedule("scrypt");
  expect(inFlight).toBe(1);

  await wait(200);
  // Exactly two completed writes, never concurrent, 2nd started after 1st ended.
  expect(writes).toBe(2);
  expect(maxConcurrent).toBe(1);
  expect(order).toEqual(["start", "end", "start", "end"]);
  rmSync(vault, { recursive: true, force: true });
});

test("IndexNoteScheduler clears running after a failed write so the project isn't stuck", async () => {
  const vault = mkdtempSync(join(tmpdir(), "rework-sched4-"));
  const db = new Database(":memory:");
  initSchema(db);
  db.run(
    `INSERT INTO notes (path, title, project, doc_type)
     VALUES ('projects/scrypt/spec/a.md','A','scrypt','spec')`,
  );
  const metadata = new MetadataRepo(db);
  const realFm = new FileManager(vault, join(vault, ".scrypt"));
  let calls = 0;
  const flakyFm = {
    writeNote: async (
      path: string,
      content: string,
      frontmatter?: Record<string, unknown>,
    ) => {
      calls += 1;
      if (calls === 1) throw new Error("disk full (simulated)");
      await realFm.writeNote(path, content, frontmatter);
    },
  } as unknown as FileManager;

  let writes = 0;
  const sched = new IndexNoteScheduler(
    { db, metadata, fm: flakyFm },
    { debounceMs: 5 },
  );
  sched.onWrite = () => { writes += 1; };

  // First schedule → writeNote rejects → flush catch fires, onWrite NOT called.
  sched.schedule("scrypt");
  await wait(60);
  expect(calls).toBe(1);
  expect(writes).toBe(0);
  expect(existsSync(join(vault, "projects/scrypt/_index.md"))).toBe(false);

  // A subsequent schedule must still produce a write (running cleared in finally).
  sched.schedule("scrypt");
  await wait(60);
  expect(calls).toBe(2);
  expect(writes).toBe(1);
  expect(existsSync(join(vault, "projects/scrypt/_index.md"))).toBe(true);
  rmSync(vault, { recursive: true, force: true });
});

