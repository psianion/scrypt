// src/server/migrations/wave9.ts
//
// Wave 9 — Intelligence Layer schema changes:
//   - drop legacy checkbox-based `tasks` table and recreate with full CRUD schema
//     (type, status, due_date, priority, metadata, client_tag)
//   - add `doc_type` and `summary` columns to `note_metadata`
//
// No back-compat: pre-beta, we drop+recreate the `tasks` table and discard old
// rows. The migration is idempotent — safe to run multiple times.
import type { Database } from "bun:sqlite";

const LEGACY_TASKS_COLS = new Set([
  "text",
  "done",
  "board",
  "line",
  "note_id",
]);

const WAVE9_TASKS_COLS = [
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
] as const;

function tableCols(db: Database, table: string): string[] {
  return (db.query(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(
    (c) => c.name,
  );
}

function isWave9TasksShape(cols: string[]): boolean {
  if (cols.length === 0) return false;
  return WAVE9_TASKS_COLS.every((c) => cols.includes(c));
}

function isLegacyTasksShape(cols: string[]): boolean {
  if (cols.length === 0) return false;
  return cols.some((c) => LEGACY_TASKS_COLS.has(c));
}

export function applyWave9Migration(db: Database): void {
  const tasksCols = tableCols(db, "tasks");

  if (tasksCols.length > 0 && !isWave9TasksShape(tasksCols)) {
    // Pre-beta: drop legacy checkbox-based tasks table and anything else that
    // doesn't match the Wave 9 shape. Old rows are discarded by design.
    if (isLegacyTasksShape(tasksCols) || !isWave9TasksShape(tasksCols)) {
      db.run(`DROP TABLE tasks`);
    }
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS tasks (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      note_path   TEXT NOT NULL,
      title       TEXT NOT NULL,
      type        TEXT NOT NULL,
      status      TEXT NOT NULL DEFAULT 'open',
      due_date    TEXT,
      priority    INTEGER DEFAULT 0,
      metadata    TEXT,
      client_tag  TEXT UNIQUE,
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_tasks_note_path ON tasks(note_path)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_tasks_type ON tasks(type)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON tasks(due_date)`);

  // note_metadata additive columns — guard by PRAGMA because ALTER ADD COLUMN
  // fails on re-run and there's no IF NOT EXISTS clause for columns.
  const metaCols = tableCols(db, "note_metadata");
  if (metaCols.length > 0) {
    if (!metaCols.includes("doc_type")) {
      db.run(`ALTER TABLE note_metadata ADD COLUMN doc_type TEXT`);
    }
    if (!metaCols.includes("summary")) {
      db.run(`ALTER TABLE note_metadata ADD COLUMN summary TEXT`);
    }
  }
}
