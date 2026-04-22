// src/server/indexer/fts-refresh.ts
//
// Recomputes a single notes_fts row by joining notes + note_metadata +
// graph_edges. Called from MCP write tools (create_note, update_note_metadata,
// add_edge, remove_edge) so the FTS5 index stays in sync with metadata and
// edge mutations without requiring triggers across three tables.
//
// FTS5 row layout: (title, content, path, summary, entities, themes, edge_reasons)
import type { Database } from "bun:sqlite";

interface NotesRow {
  id: number;
  title: string | null;
}

interface MetadataRow {
  description: string | null;
  summary: string | null;
  entities: string | null;
  themes: string | null;
}

interface EdgeRow {
  reason: string | null;
}

interface ContentRow {
  content_hash: string | null;
}

interface FtsContentRow {
  content: string | null;
}

function flattenEntities(json: string | null): string {
  if (!json) return "";
  try {
    const parsed = JSON.parse(json) as Array<{ name?: unknown }>;
    if (!Array.isArray(parsed)) return "";
    return parsed
      .map((e) => (e && typeof e.name === "string" ? e.name : ""))
      .filter(Boolean)
      .join(" ");
  } catch {
    return "";
  }
}

function flattenThemes(json: string | null): string {
  if (!json) return "";
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!Array.isArray(parsed)) return "";
    return parsed.filter((t): t is string => typeof t === "string").join(" ");
  } catch {
    return "";
  }
}

function joinSummary(
  description: string | null,
  summary: string | null,
): string {
  const parts = [description, summary].filter(
    (s): s is string => typeof s === "string" && s.length > 0,
  );
  return parts.join(" ");
}

function collectEdgeReasons(db: Database, path: string): string {
  const rows = db
    .query<EdgeRow, [string, string]>(
      `SELECT reason FROM graph_edges WHERE source = ? OR target = ?`,
    )
    .all(path, path);
  return rows
    .map((r) => r.reason)
    .filter((s): s is string => typeof s === "string" && s.length > 0)
    .join(" ");
}

export function refreshNoteFts(db: Database, path: string): void {
  const notesRow = db
    .query<NotesRow, [string]>(
      `SELECT id, title FROM notes WHERE path = ?`,
    )
    .get(path);

  // Pull title from graph_nodes when there's no `notes` row yet (MCP write
  // tools may run before the legacy indexer has populated `notes`).
  let title: string;
  if (notesRow) {
    title = notesRow.title ?? "";
  } else {
    const gn = db
      .query<{ label: string | null }, [string]>(
        `SELECT label FROM graph_nodes WHERE id = ? AND kind = 'note'`,
      )
      .get(path);
    if (!gn) return;
    title = gn.label ?? "";
  }

  // Existing FTS row content survives a metadata/edge refresh — only the
  // legacy indexer rewrites the body.
  let content = "";
  if (notesRow) {
    const existing = db
      .query<FtsContentRow, [number]>(
        `SELECT content FROM notes_fts WHERE rowid = ?`,
      )
      .get(notesRow.id);
    content = existing?.content ?? "";
  }

  const meta = db
    .query<MetadataRow, [string]>(
      `SELECT description, summary, entities, themes
         FROM note_metadata WHERE note_path = ?`,
    )
    .get(path);

  const summary = meta ? joinSummary(meta.description, meta.summary) : "";
  const entities = meta ? flattenEntities(meta.entities) : "";
  const themes = meta ? flattenThemes(meta.themes) : "";
  const edgeReasons = collectEdgeReasons(db, path);

  if (notesRow) {
    db.query(
      `INSERT OR REPLACE INTO notes_fts
         (rowid, title, content, path, summary, entities, themes, edge_reasons)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      notesRow.id,
      title,
      content,
      path,
      summary,
      entities,
      themes,
      edgeReasons,
    );
    return;
  }

  // No notes row: use a path-keyed upsert so MCP-only callers still get
  // metadata/edge text into the index. The legacy indexer will overwrite
  // this row by rowid once it processes the file.
  db.query(`DELETE FROM notes_fts WHERE path = ?`).run(path);
  db.query(
    `INSERT INTO notes_fts
       (title, content, path, summary, entities, themes, edge_reasons)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(title, content, path, summary, entities, themes, edgeReasons);
}
