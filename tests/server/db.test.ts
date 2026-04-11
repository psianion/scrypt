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
});
