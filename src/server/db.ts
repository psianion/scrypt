// src/server/db.ts
import { Database } from "bun:sqlite";
import { applyWave8Migration } from "./migrations/wave8";
import { applyWave9Migration } from "./migrations/wave9";

export function createDatabase(dbPath: string): Database {
  const db = new Database(dbPath, { create: true });
  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA foreign_keys = ON");
  return db;
}

export function initSchema(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS notes (
      id INTEGER PRIMARY KEY,
      path TEXT UNIQUE NOT NULL,
      title TEXT,
      content_hash TEXT,
      created TEXT,
      modified TEXT
    )
  `);

  // graph-v2 (G4): widened FTS5 to also index summary, entities, themes, and
  // edge_reasons so /api/search hits notes whose match lives only in metadata
  // or in an edge's reason field. Detect the legacy 3-column shape and drop
  // it — pre-beta, test vault, no migration. The FTS5 row is repopulated by
  // the legacy indexer (body) and refreshNoteFts (metadata + edges).
  const ftsCols = db
    .query("PRAGMA table_info(notes_fts)")
    .all() as { name: string }[];
  const expectedFtsCols = [
    "title",
    "content",
    "path",
    "summary",
    "entities",
    "themes",
    "edge_reasons",
  ];
  const haveFts = new Set(ftsCols.map((c) => c.name));
  const ftsShapeMismatch =
    ftsCols.length > 0 && expectedFtsCols.some((c) => !haveFts.has(c));
  if (ftsShapeMismatch) {
    db.run("DROP TABLE IF EXISTS notes_fts");
  }
  db.run(`
    CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
      title, content, path, summary, entities, themes, edge_reasons
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS backlinks (
      source_id INTEGER REFERENCES notes(id) ON DELETE CASCADE,
      target_id INTEGER REFERENCES notes(id) ON DELETE CASCADE,
      context TEXT,
      PRIMARY KEY (source_id, target_id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS tags (
      note_id INTEGER REFERENCES notes(id) ON DELETE CASCADE,
      tag TEXT NOT NULL,
      PRIMARY KEY (note_id, tag)
    )
  `);

  // graph-v2: graph_edges schema collapsed to (source,target,tier). The legacy
  // integer-keyed shape (source_id) and the Wave 8/9 (relation, confidence)
  // shape are both dropped on detection. Pre-beta — test vault, no migration.
  const graphEdgeCols = db
    .query("PRAGMA table_info(graph_edges)")
    .all() as { name: string }[];
  const hasLegacy =
    graphEdgeCols.length > 0 &&
    (graphEdgeCols.some((c) => c.name === "source_id") ||
      graphEdgeCols.some((c) => c.name === "relation") ||
      graphEdgeCols.some((c) => c.name === "confidence") ||
      !graphEdgeCols.some((c) => c.name === "tier"));
  if (hasLegacy) {
    db.run("DROP TABLE IF EXISTS graph_edges");
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS graph_nodes (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK (kind IN ('note','section','tag')),
      note_path TEXT,
      label TEXT,
      community_id INTEGER,
      content_hash TEXT
    )
  `);
  db.run(
    `CREATE INDEX IF NOT EXISTS idx_graph_nodes_note ON graph_nodes(note_path)`,
  );
  db.run(
    `CREATE INDEX IF NOT EXISTS idx_graph_nodes_kind ON graph_nodes(kind)`,
  );

  db.run(`
    CREATE TABLE IF NOT EXISTS graph_edges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,
      target TEXT NOT NULL,
      tier TEXT NOT NULL CHECK (tier IN ('connected','mentions','semantically_related')),
      weight REAL,
      reason TEXT,
      client_tag TEXT,
      created_at INTEGER,
      UNIQUE (source, target, tier)
    )
  `);
  db.run(
    `CREATE INDEX IF NOT EXISTS idx_graph_edges_source ON graph_edges(source)`,
  );
  db.run(
    `CREATE INDEX IF NOT EXISTS idx_graph_edges_target ON graph_edges(target)`,
  );
  db.run(
    `CREATE INDEX IF NOT EXISTS idx_graph_edges_tier ON graph_edges(tier)`,
  );

  db.run(`
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY,
      note_id INTEGER REFERENCES notes(id) ON DELETE CASCADE,
      text TEXT NOT NULL,
      done INTEGER DEFAULT 0,
      due_date TEXT,
      priority INTEGER DEFAULT 0,
      board TEXT DEFAULT 'backlog',
      line INTEGER DEFAULT 0
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS aliases (
      note_id INTEGER REFERENCES notes(id) ON DELETE CASCADE,
      alias TEXT NOT NULL,
      PRIMARY KEY (note_id, alias)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS csv_cache (
      file_path TEXT PRIMARY KEY,
      headers TEXT,
      row_count INTEGER,
      last_parsed TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS metadata (
      key TEXT PRIMARY KEY,
      value TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS activity_log (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp  TEXT    NOT NULL,
      action     TEXT    NOT NULL,
      kind       TEXT,
      path       TEXT    NOT NULL,
      actor      TEXT    NOT NULL,
      meta       TEXT
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_activity_timestamp ON activity_log(timestamp DESC)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_activity_actor ON activity_log(actor, timestamp DESC)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_activity_kind ON activity_log(kind, timestamp DESC)`);

  db.run(`
    CREATE TABLE IF NOT EXISTS research_runs (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      thread_slug   TEXT    NOT NULL,
      note_path     TEXT    NOT NULL,
      status        TEXT    NOT NULL,
      started_at    TEXT    NOT NULL,
      completed_at  TEXT,
      duration_ms   INTEGER,
      model         TEXT,
      tokens_in     INTEGER,
      tokens_out    INTEGER,
      error         TEXT
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_runs_thread ON research_runs(thread_slug, started_at DESC)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_runs_status ON research_runs(status, started_at DESC)`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS link_index (
      slug TEXT NOT NULL,
      path TEXT NOT NULL,
      title TEXT,
      PRIMARY KEY (slug, path)
    );
    CREATE INDEX IF NOT EXISTS link_index_slug_idx ON link_index (slug);
  `);

  // Additive migration: notes.domain / subdomain / tags were introduced in
  // Wave 7 for the domain-aware graph. Older DBs may not have them, so add
  // each column only when PRAGMA table_info confirms it's missing.
  const noteCols = db
    .query("PRAGMA table_info(notes)")
    .all() as { name: string }[];
  const have = new Set(noteCols.map((c) => c.name));
  if (!have.has("domain")) db.run("ALTER TABLE notes ADD COLUMN domain TEXT");
  if (!have.has("subdomain"))
    db.run("ALTER TABLE notes ADD COLUMN subdomain TEXT");
  if (!have.has("tags")) db.run("ALTER TABLE notes ADD COLUMN tags TEXT");

  // Wave 8: note_metadata, note_sections, note_chunk_embeddings, mcp_dedup.
  applyWave8Migration(db);

  // Wave 9: drop legacy tasks, recreate with full CRUD schema;
  // add doc_type + summary to note_metadata.
  applyWave9Migration(db);
}
