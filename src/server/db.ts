// src/server/db.ts
import { Database } from "bun:sqlite";

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

  db.run(`
    CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
      title, content, path
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

  db.run(`
    CREATE TABLE IF NOT EXISTS graph_edges (
      source_id INTEGER REFERENCES notes(id) ON DELETE CASCADE,
      target_id INTEGER REFERENCES notes(id) ON DELETE CASCADE,
      type TEXT CHECK(type IN ('link', 'tag', 'embed')),
      PRIMARY KEY (source_id, target_id, type)
    )
  `);

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
}
