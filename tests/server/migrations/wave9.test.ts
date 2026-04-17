// tests/server/migrations/wave9.test.ts
import { test, expect, beforeEach, describe } from "bun:test";
import { Database } from "bun:sqlite";
import { applyWave9Migration } from "../../../src/server/migrations/wave9";
import { applyWave8Migration } from "../../../src/server/migrations/wave8";
import { initSchema } from "../../../src/server/db";
import { DOC_TYPES } from "../../../src/server/indexer/metadata-repo";

describe("wave9 migration", () => {
  let db: Database;
  beforeEach(() => {
    db = new Database(":memory:");
  });

  test("creates tasks table with full schema", () => {
    applyWave8Migration(db);
    applyWave9Migration(db);

    const cols = db
      .query<{ name: string; notnull: number; dflt_value: string | null; pk: number }, []>(
        `PRAGMA table_info(tasks)`,
      )
      .all();
    const byName = new Map(cols.map((c) => [c.name, c]));

    for (const name of [
      "id",
      "note_path",
      "title",
      "type",
      "status",
      "due_date",
      "priority",
      "metadata",
      "client_tag",
      "created_at",
      "updated_at",
    ]) {
      expect(byName.has(name)).toBe(true);
    }
    expect(byName.get("id")!.pk).toBe(1);
  });

  test("note_path is nullable, timestamps default to unixepoch()", () => {
    applyWave8Migration(db);
    applyWave9Migration(db);

    const cols = db
      .query<{ name: string; notnull: number; dflt_value: string | null }, []>(
        `PRAGMA table_info(tasks)`,
      )
      .all();
    const byName = new Map(cols.map((c) => [c.name, c]));
    expect(byName.get("note_path")!.notnull).toBe(0);
    expect(byName.get("created_at")!.notnull).toBe(1);
    expect(byName.get("updated_at")!.notnull).toBe(1);
    expect(byName.get("created_at")!.dflt_value).toContain("unixepoch");
    expect(byName.get("updated_at")!.dflt_value).toContain("unixepoch");

    // Insert with only title+type — everything else should default.
    db.run(`INSERT INTO tasks (title, type) VALUES ('no-note', 'PLAN')`);
    const row = db
      .query<
        { note_path: string | null; status: string; priority: number; created_at: number; updated_at: number },
        []
      >(`SELECT note_path, status, priority, created_at, updated_at FROM tasks`)
      .get()!;
    expect(row.note_path).toBeNull();
    expect(row.status).toBe("open");
    expect(row.priority).toBe(0);
    expect(row.created_at).toBeGreaterThan(0);
    expect(row.updated_at).toBeGreaterThan(0);
  });

  test("creates tasks indexes", () => {
    applyWave8Migration(db);
    applyWave9Migration(db);

    const idx = db
      .query<{ name: string }, []>(
        `SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='tasks'`,
      )
      .all()
      .map((r) => r.name);
    expect(idx).toContain("idx_tasks_note_path");
    expect(idx).toContain("idx_tasks_status");
    expect(idx).toContain("idx_tasks_type");
    expect(idx).toContain("idx_tasks_due_date");
  });

  test("tasks.client_tag is UNIQUE", () => {
    applyWave8Migration(db);
    applyWave9Migration(db);

    db.run(
      `INSERT INTO tasks (note_path, title, type, client_tag) VALUES ('a.md', 'T1', 'PLAN', 'tag-1')`,
    );
    expect(() =>
      db.run(
        `INSERT INTO tasks (note_path, title, type, client_tag) VALUES ('b.md', 'T2', 'PLAN', 'tag-1')`,
      ),
    ).toThrow();
  });

  test("tasks.type CHECK rejects unknown values", () => {
    applyWave8Migration(db);
    applyWave9Migration(db);
    // Allowed
    expect(() =>
      db.run(
        `INSERT INTO tasks (title, type) VALUES ('x', 'BRAINSTORM')`,
      ),
    ).not.toThrow();
    // Disallowed (lowercase — old enum)
    expect(() =>
      db.run(`INSERT INTO tasks (title, type) VALUES ('x', 'plan')`),
    ).toThrow();
    // Disallowed (bogus)
    expect(() =>
      db.run(`INSERT INTO tasks (title, type) VALUES ('x', 'FOO')`),
    ).toThrow();
  });

  test("tasks.status CHECK rejects unknown values", () => {
    applyWave8Migration(db);
    applyWave9Migration(db);
    db.run(`INSERT INTO tasks (title, type) VALUES ('x', 'PLAN')`);
    // Allowed transitions
    for (const s of ["open", "in_progress", "closed"]) {
      expect(() =>
        db.run(
          `INSERT INTO tasks (title, type, status) VALUES ('x', 'PLAN', '${s}')`,
        ),
      ).not.toThrow();
    }
    // Disallowed (dropped done/cancelled values)
    for (const s of ["done", "cancelled", "pending"]) {
      expect(() =>
        db.run(
          `INSERT INTO tasks (title, type, status) VALUES ('x', 'PLAN', '${s}')`,
        ),
      ).toThrow();
    }
  });

  test("adds doc_type and summary columns to note_metadata", () => {
    applyWave8Migration(db);
    applyWave9Migration(db);

    const cols = db
      .query<{ name: string }, []>(`PRAGMA table_info(note_metadata)`)
      .all()
      .map((r) => r.name);
    expect(cols).toContain("doc_type");
    expect(cols).toContain("summary");
  });

  test("DOC_TYPES enum contains the spec values (no reference, with review+guide)", () => {
    expect([...DOC_TYPES].sort()).toEqual(
      [
        "architecture",
        "changelog",
        "guide",
        "journal",
        "other",
        "plan",
        "research",
        "review",
        "spec",
      ].sort(),
    );
    expect((DOC_TYPES as readonly string[]).includes("reference")).toBe(false);
  });

  test("drops and recreates pre-existing legacy tasks table (pre-beta wipe)", () => {
    // Simulate legacy v1 tasks table
    db.run(`CREATE TABLE tasks (
      id INTEGER PRIMARY KEY,
      note_id INTEGER,
      text TEXT NOT NULL,
      done INTEGER DEFAULT 0
    )`);
    db.run(`INSERT INTO tasks (text, done) VALUES ('legacy todo', 0)`);

    applyWave8Migration(db);
    applyWave9Migration(db);

    const cols = db
      .query<{ name: string }, []>(`PRAGMA table_info(tasks)`)
      .all()
      .map((r) => r.name);
    expect(cols).toContain("title");
    expect(cols).toContain("type");
    expect(cols).not.toContain("text");
    expect(cols).not.toContain("done");

    const count = db
      .query<{ c: number }, []>(`SELECT COUNT(*) AS c FROM tasks`)
      .get()!;
    expect(count.c).toBe(0);
  });

  test("drops and recreates a pre-existing NO-CHECK Wave 9 tasks table", () => {
    // Simulate the first-cut Wave 9 schema that lacked CHECK constraints.
    db.run(`CREATE TABLE tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      note_path TEXT NOT NULL,
      title TEXT NOT NULL,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      due_date TEXT,
      priority INTEGER DEFAULT 0,
      metadata TEXT,
      client_tag TEXT UNIQUE,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`);
    applyWave8Migration(db);
    applyWave9Migration(db);

    // Now CHECK should reject lowercase "plan".
    expect(() =>
      db.run(`INSERT INTO tasks (title, type) VALUES ('x', 'plan')`),
    ).toThrow();
  });

  test("wipes legacy-confidence edges (extracted/inferred/ambiguous)", () => {
    applyWave8Migration(db);
    // pre-seed graph_edges before wave9 runs
    db.run(`
      CREATE TABLE IF NOT EXISTS graph_edges (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source TEXT, target TEXT, relation TEXT,
        weight REAL, confidence TEXT, reason TEXT,
        client_tag TEXT, created_at INTEGER,
        UNIQUE(source, target, relation)
      )
    `);
    const now = Date.now();
    db.run(
      `INSERT INTO graph_edges (source,target,relation,confidence,created_at)
       VALUES
         ('a','b','r1','extracted',?),
         ('a','c','r2','inferred',?),
         ('a','d','r3','ambiguous',?),
         ('a','e','r4','connected',?),
         ('a','f','r5',NULL,?)`,
      [now, now, now, now, now],
    );
    applyWave9Migration(db);
    const rows = db
      .query<{ confidence: string | null }, []>(
        `SELECT confidence FROM graph_edges ORDER BY target`,
      )
      .all();
    const confs = rows.map((r) => r.confidence);
    expect(confs).toEqual(["connected", null]);
  });

  test("migration is idempotent", () => {
    applyWave8Migration(db);
    applyWave9Migration(db);
    expect(() => applyWave9Migration(db)).not.toThrow();
    expect(() => applyWave9Migration(db)).not.toThrow();

    // After idempotent runs we can still insert valid rows.
    db.run(`INSERT INTO tasks (title, type) VALUES ('ok', 'PLAN')`);
    const c = db.query<{ c: number }, []>(`SELECT COUNT(*) AS c FROM tasks`).get()!;
    expect(c.c).toBe(1);
  });

  test("initSchema wires wave9 after wave8", () => {
    initSchema(db);

    const cols = db
      .query<{ name: string }, []>(`PRAGMA table_info(note_metadata)`)
      .all()
      .map((r) => r.name);
    expect(cols).toContain("doc_type");
    expect(cols).toContain("summary");

    const taskCols = db
      .query<{ name: string }, []>(`PRAGMA table_info(tasks)`)
      .all()
      .map((r) => r.name);
    expect(taskCols).toContain("title");
    expect(taskCols).toContain("type");
    expect(taskCols).toContain("client_tag");
  });
});
