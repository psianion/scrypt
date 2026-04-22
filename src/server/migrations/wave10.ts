// src/server/migrations/wave10.ts
//
// Adds project / doc_type / thread columns to `notes` for the project-first
// ingest layout (projects/<project>/<doc_type>/<slug>.md). Idempotent: only
// runs ALTER if the column is missing, and uses CREATE INDEX IF NOT EXISTS.
import type { Database } from "bun:sqlite";

export function runWave10(db: Database): void {
  const cols = (
    db.query("PRAGMA table_info(notes)").all() as { name: string }[]
  ).map((c) => c.name);

  if (!cols.includes("project"))
    db.run(`ALTER TABLE notes ADD COLUMN project TEXT`);
  if (!cols.includes("doc_type"))
    db.run(`ALTER TABLE notes ADD COLUMN doc_type TEXT`);
  if (!cols.includes("thread"))
    db.run(`ALTER TABLE notes ADD COLUMN thread TEXT`);

  db.run(`CREATE INDEX IF NOT EXISTS idx_notes_project ON notes(project)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_notes_doc_type ON notes(doc_type)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_notes_thread ON notes(thread)`);
}

// Alias to match the existing applyWaveNMigration naming convention used by db.ts.
export const applyWave10Migration = runWave10;
