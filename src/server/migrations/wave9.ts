// src/server/migrations/wave9.ts
//
// Wave 9 — Intelligence Layer schema changes:
//   - drop legacy checkbox-based `tasks` table and recreate with full CRUD schema
//     (type CHECK, status CHECK, nullable note_path, default unixepoch timestamps)
//   - add `doc_type` and `summary` columns to `note_metadata`
//   - wipe edges using retired confidence values (extracted/inferred/ambiguous)
//
// No back-compat: pre-beta, we drop+recreate the `tasks` table and discard old
// rows. The migration is idempotent — safe to run multiple times.
import type { Database } from "bun:sqlite";

export const TASK_TYPES_SQL = [
  "BRAINSTORM",
  "PLAN",
  "BUILD",
  "RESEARCH",
  "REVIEW",
  "CUSTOM",
] as const;

export const TASK_STATUSES_SQL = ["open", "in_progress", "closed"] as const;

const TASK_TYPE_CHECK = `type IN (${TASK_TYPES_SQL.map((v) => `'${v}'`).join(",")})`;
const TASK_STATUS_CHECK = `status IN (${TASK_STATUSES_SQL.map((v) => `'${v}'`).join(",")})`;

const CREATE_TASKS_SQL = `
  CREATE TABLE tasks (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    note_path   TEXT,
    title       TEXT NOT NULL,
    type        TEXT NOT NULL CHECK (${TASK_TYPE_CHECK}),
    status      TEXT NOT NULL DEFAULT 'open' CHECK (${TASK_STATUS_CHECK}),
    due_date    TEXT,
    priority    INTEGER DEFAULT 0,
    metadata    TEXT,
    client_tag  TEXT UNIQUE,
    created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at  INTEGER NOT NULL DEFAULT (unixepoch())
  )
`;

function tableCols(db: Database, table: string): string[] {
  return (db.query(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(
    (c) => c.name,
  );
}

function getTableSql(db: Database, table: string): string | null {
  const row = db
    .query<{ sql: string | null }, [string]>(
      `SELECT sql FROM sqlite_master WHERE type='table' AND name = ?`,
    )
    .get(table);
  return row?.sql ?? null;
}

export function applyWave9Migration(db: Database): void {
  // Drop + recreate `tasks` whenever the stored CREATE SQL doesn't include the
  // Wave 9 CHECK constraints. This catches both the legacy (checkbox) shape
  // and the in-flight first-cut Wave 9 shape that lacked CHECKs.
  const existingSql = getTableSql(db, "tasks");
  const needsRecreate =
    existingSql === null ||
    !existingSql.includes("CHECK (type IN") ||
    !existingSql.includes("CHECK (status IN");
  if (existingSql !== null && needsRecreate) {
    db.run(`DROP TABLE tasks`);
  }
  if (needsRecreate) {
    db.run(CREATE_TASKS_SQL);
  }
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

  // Wave 9 swaps the add_edge confidence enum: extracted/inferred/ambiguous
  // → connected/mentions/semantically_related. Pre-beta: wipe any rows using
  // the retired values rather than remapping (old values had different
  // semantics so translation would be wrong).
  const graphEdgesCols = tableCols(db, "graph_edges");
  if (graphEdgesCols.includes("confidence")) {
    db.run(
      `DELETE FROM graph_edges
       WHERE confidence IN ('extracted','inferred','ambiguous')`,
    );
  }
}
