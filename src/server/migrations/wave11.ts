// src/server/migrations/wave11.ts
//
// Ingestion rework Wave 11 — combines two changes that both target
// graph_edges:
//   • C4: add the `rel_type` column for curated AI typed edges
//     (builds_on/replaces/contradicts/part_of/cites/relates_to).
//   • C3: drop all legacy `tier='semantically_related'` rows — cosine is
//     demoted off-graph (pre-beta destructive posture; these rows carry no
//     curated meaning).
// Both steps are idempotent: the ALTER only runs when PRAGMA table_info
// confirms the column is missing, and a DELETE that matches nothing is a
// safe no-op. A table-existence guard makes the whole thing safe to run
// before graph_edges exists in a fresh schema.
import type { Database } from "bun:sqlite";

export function runWave11(db: Database): void {
  const tables = db
    .query<{ name: string }, [string]>(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`,
    )
    .all("graph_edges");
  if (tables.length === 0) return;

  const cols = (
    db.query("PRAGMA table_info(graph_edges)").all() as { name: string }[]
  ).map((c) => c.name);

  // C4: additive rel_type column.
  if (!cols.includes("rel_type"))
    db.run(`ALTER TABLE graph_edges ADD COLUMN rel_type TEXT`);

  // C3: destructive drop of legacy cosine edges.
  db.run(`DELETE FROM graph_edges WHERE tier = 'semantically_related'`);
}

// Alias to match the existing applyWaveNMigration naming convention used by db.ts.
export const applyWave11Migration = runWave11;
