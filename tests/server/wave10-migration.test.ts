import { test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { runWave10 } from "../../src/server/migrations/wave10";

function seed(): Database {
  const db = new Database(":memory:");
  db.run(`CREATE TABLE notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    path TEXT UNIQUE NOT NULL,
    title TEXT,
    domain TEXT,
    subdomain TEXT,
    tags TEXT,
    modified INTEGER
  )`);
  return db;
}

test("wave10 adds project, doc_type, thread columns", () => {
  const db = seed();
  runWave10(db);
  const cols = (
    db.query("PRAGMA table_info(notes)").all() as { name: string }[]
  ).map((c) => c.name);
  expect(cols).toContain("project");
  expect(cols).toContain("doc_type");
  expect(cols).toContain("thread");
});

test("wave10 creates indexes on project + doc_type + thread", () => {
  const db = seed();
  runWave10(db);
  const idx = (
    db.query("PRAGMA index_list(notes)").all() as { name: string }[]
  ).map((i) => i.name);
  expect(idx).toContain("idx_notes_project");
  expect(idx).toContain("idx_notes_doc_type");
  expect(idx).toContain("idx_notes_thread");
});

test("wave10 is idempotent", () => {
  const db = seed();
  runWave10(db);
  expect(() => runWave10(db)).not.toThrow();
});
