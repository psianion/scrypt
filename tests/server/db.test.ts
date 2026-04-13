// tests/server/db.test.ts
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createDatabase, initSchema } from "../../src/server/db";

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "scrypt-db-test-"));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("createDatabase", () => {
  test("creates SQLite database file", () => {
    const dbPath = join(tempDir, "test.db");
    const db = createDatabase(dbPath);
    expect(db).toBeInstanceOf(Database);
    db.close();
  });

  test("enables WAL mode", () => {
    const dbPath = join(tempDir, "test.db");
    const db = createDatabase(dbPath);
    const mode = db.query("PRAGMA journal_mode").get() as { journal_mode: string };
    expect(mode.journal_mode).toBe("wal");
    db.close();
  });
});

describe("initSchema", () => {
  test("creates all required tables", () => {
    const db = createDatabase(join(tempDir, "test.db"));
    initSchema(db);

    const tables = db
      .query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];
    const names = tables.map((t) => t.name);

    expect(names).toContain("notes");
    expect(names).toContain("backlinks");
    expect(names).toContain("tags");
    expect(names).toContain("graph_edges");
    expect(names).toContain("tasks");
    expect(names).toContain("aliases");
    expect(names).toContain("csv_cache");
    expect(names).toContain("metadata");
    db.close();
  });

  test("creates FTS5 virtual table", () => {
    const db = createDatabase(join(tempDir, "test.db"));
    initSchema(db);

    const tables = db
      .query("SELECT name FROM sqlite_master WHERE type='table' AND name='notes_fts'")
      .all();
    expect(tables).toHaveLength(1);
    db.close();
  });

  test("is idempotent — running twice does not error", () => {
    const db = createDatabase(join(tempDir, "test.db"));
    initSchema(db);
    initSchema(db);
    db.close();
  });

  test("creates link_index table with slug/path/title columns and slug index", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const cols = db
      .query("PRAGMA table_info(link_index)")
      .all() as any[];
    const names = cols.map((c) => c.name);
    expect(names).toContain("slug");
    expect(names).toContain("path");
    expect(names).toContain("title");

    const idxs = db
      .query(
        "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='link_index'",
      )
      .all() as any[];
    expect(idxs.some((i) => i.name === "link_index_slug_idx")).toBe(true);
    db.close();
  });
});

describe("initSchema > new research node tables", () => {
  test("creates activity_log table with correct columns", () => {
    const db = createDatabase(":memory:");
    initSchema(db);
    const cols = db
      .query("PRAGMA table_info(activity_log)")
      .all() as { name: string }[];
    const names = cols.map((c) => c.name).sort();
    expect(names).toEqual(
      ["action", "actor", "id", "kind", "meta", "path", "timestamp"].sort(),
    );
  });

  test("creates research_runs table with correct columns", () => {
    const db = createDatabase(":memory:");
    initSchema(db);
    const cols = db
      .query("PRAGMA table_info(research_runs)")
      .all() as { name: string }[];
    const names = cols.map((c) => c.name).sort();
    expect(names).toEqual(
      [
        "completed_at",
        "duration_ms",
        "error",
        "id",
        "model",
        "note_path",
        "started_at",
        "status",
        "thread_slug",
        "tokens_in",
        "tokens_out",
      ].sort(),
    );
  });

  test("creates indexes on activity_log and research_runs", () => {
    const db = createDatabase(":memory:");
    initSchema(db);
    const idx = db
      .query("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'")
      .all() as { name: string }[];
    const names = idx.map((i) => i.name);
    expect(names).toContain("idx_activity_timestamp");
    expect(names).toContain("idx_activity_actor");
    expect(names).toContain("idx_activity_kind");
    expect(names).toContain("idx_runs_thread");
    expect(names).toContain("idx_runs_status");
  });
});
