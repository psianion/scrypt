// src/server/migrations/wave8.ts
//
// Wave 8 adds four new tables alongside the refactored graph layer:
//   - note_metadata      (semantic per-note metadata: description, entities, themes)
//   - note_sections      (per-heading rows; targets for section-level edges)
//   - note_chunk_embeddings  (N rows per note — one vector per chunk)
//   - mcp_dedup          (client_tag-based idempotency for MCP write tools)
//
// The graph_nodes/graph_edges schema changes landed in the initSchema
// refactor (see db.ts) because they are prerequisites for the existing
// indexer and the Wave 7 graph API, not just the Wave 8 MCP surface.
//
// This migration is safe to run multiple times.
import type { Database } from "bun:sqlite";

const STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS note_metadata (
     note_path   TEXT PRIMARY KEY,
     description TEXT,
     entities    TEXT,
     themes      TEXT,
     updated_at  INTEGER NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS note_sections (
     id           TEXT PRIMARY KEY,
     note_path    TEXT NOT NULL,
     heading_slug TEXT NOT NULL,
     heading_text TEXT NOT NULL,
     level        INTEGER NOT NULL,
     summary      TEXT,
     start_line   INTEGER NOT NULL,
     end_line     INTEGER NOT NULL,
     UNIQUE (note_path, heading_slug)
   )`,
  `CREATE INDEX IF NOT EXISTS idx_note_sections_path ON note_sections(note_path)`,
  `CREATE TABLE IF NOT EXISTS note_chunk_embeddings (
     note_path    TEXT NOT NULL,
     chunk_id     TEXT NOT NULL,
     chunk_text   TEXT NOT NULL,
     start_line   INTEGER NOT NULL,
     end_line     INTEGER NOT NULL,
     model        TEXT NOT NULL,
     dims         INTEGER NOT NULL,
     vector       BLOB NOT NULL,
     content_hash TEXT NOT NULL,
     created_at   INTEGER NOT NULL,
     PRIMARY KEY (note_path, chunk_id)
   )`,
  `CREATE INDEX IF NOT EXISTS idx_chunk_emb_model ON note_chunk_embeddings(model)`,
  `CREATE INDEX IF NOT EXISTS idx_chunk_emb_note  ON note_chunk_embeddings(note_path)`,
  `CREATE TABLE IF NOT EXISTS mcp_dedup (
     client_tag TEXT PRIMARY KEY,
     tool       TEXT NOT NULL,
     response   TEXT NOT NULL,
     created_at INTEGER NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_mcp_dedup_created ON mcp_dedup(created_at)`,
];

export function applyWave8Migration(db: Database): void {
  // graph-v2: pre-beta destructive drop if legacy `auto_tags` column is
  // present. Test vault re-ingests after the series, so no migration.
  const cols = (db.query(`PRAGMA table_info(note_metadata)`).all() as { name: string }[]).map(
    (c) => c.name,
  );
  if (cols.length > 0 && cols.includes("auto_tags")) {
    db.run(`DROP TABLE note_metadata`);
  }
  for (const sql of STATEMENTS) {
    db.run(sql);
  }
}
