import { test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { initSchema } from "../../src/server/db";

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
