// src/server/sync/state.ts
//
// Per-machine record of the content hash last agreed with the hub for
// each note ("base"). Used to tell which side changed since last sync.
import type { Database } from "bun:sqlite";

export function loadBase(db: Database): Map<string, string> {
  const rows = db
    .query("SELECT note_path, base_hash FROM sync_state")
    .all() as { note_path: string; base_hash: string }[];
  return new Map(rows.map((r) => [r.note_path, r.base_hash]));
}

export function setBase(db: Database, notePath: string, hash: string, content?: string): void {
  db.run(
    `INSERT INTO sync_state (note_path, base_hash, base_content, synced_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(note_path)
       DO UPDATE SET base_hash = excluded.base_hash,
                     base_content = excluded.base_content,
                     synced_at = excluded.synced_at`,
    [notePath, hash, content ?? null, Date.now()],
  );
}

export function getBase(db: Database, notePath: string): { hash: string; content: string | null } | null {
  const row = db
    .query("SELECT base_hash, base_content FROM sync_state WHERE note_path = ?")
    .get(notePath) as { base_hash: string; base_content: string | null } | null;
  return row ? { hash: row.base_hash, content: row.base_content } : null;
}

export function clearBase(db: Database, notePath: string): void {
  db.run("DELETE FROM sync_state WHERE note_path = ?", [notePath]);
}
