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
