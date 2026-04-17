// src/server/indexer/metadata-repo.ts
//
// CRUD over note_metadata — the semantic layer produced by the MCP
// caller (Claude) after it reads a note. Scrypt stores what it's told.
import type { Database } from "bun:sqlite";

export const DOC_TYPES = [
  "research",
  "spec",
  "plan",
  "architecture",
  "review",
  "guide",
  "journal",
  "changelog",
  "other",
] as const;
export type DocType = (typeof DOC_TYPES)[number];

export interface NoteMetadataPatch {
  description?: string;
  auto_tags?: string[];
  entities?: { name: string; kind: string }[];
  themes?: string[];
  doc_type?: DocType;
  summary?: string;
}

interface NoteMetadata {
  note_path: string;
  description: string | null;
  auto_tags: string[] | null;
  entities: { name: string; kind: string }[] | null;
  themes: string[] | null;
  doc_type: DocType | null;
  summary: string | null;
  updated_at: number;
}

interface Row {
  note_path: string;
  description: string | null;
  auto_tags: string | null;
  entities: string | null;
  themes: string | null;
  doc_type: string | null;
  summary: string | null;
  updated_at: number;
}

export class MetadataRepo {
  constructor(private db: Database) {}

  get(notePath: string): NoteMetadata | null {
    const row = this.db
      .query<Row, [string]>(`SELECT * FROM note_metadata WHERE note_path = ?`)
      .get(notePath);
    if (!row) return null;
    return {
      note_path: row.note_path,
      description: row.description,
      auto_tags: row.auto_tags ? JSON.parse(row.auto_tags) : null,
      entities: row.entities ? JSON.parse(row.entities) : null,
      themes: row.themes ? JSON.parse(row.themes) : null,
      doc_type: (row.doc_type as DocType | null) ?? null,
      summary: row.summary,
      updated_at: row.updated_at,
    };
  }

  upsert(notePath: string, patch: NoteMetadataPatch): void {
    const existing = this.get(notePath);
    const merged = {
      description:
        patch.description !== undefined
          ? patch.description
          : existing?.description ?? null,
      auto_tags:
        patch.auto_tags !== undefined
          ? patch.auto_tags
          : existing?.auto_tags ?? null,
      entities:
        patch.entities !== undefined
          ? patch.entities
          : existing?.entities ?? null,
      themes:
        patch.themes !== undefined ? patch.themes : existing?.themes ?? null,
      doc_type:
        patch.doc_type !== undefined
          ? patch.doc_type
          : existing?.doc_type ?? null,
      summary:
        patch.summary !== undefined ? patch.summary : existing?.summary ?? null,
    };
    this.db
      .query(
        `INSERT INTO note_metadata
           (note_path, description, auto_tags, entities, themes, doc_type, summary, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(note_path) DO UPDATE SET
           description = excluded.description,
           auto_tags   = excluded.auto_tags,
           entities    = excluded.entities,
           themes      = excluded.themes,
           doc_type    = excluded.doc_type,
           summary     = excluded.summary,
           updated_at  = excluded.updated_at`,
      )
      .run(
        notePath,
        merged.description,
        merged.auto_tags ? JSON.stringify(merged.auto_tags) : null,
        merged.entities ? JSON.stringify(merged.entities) : null,
        merged.themes ? JSON.stringify(merged.themes) : null,
        merged.doc_type,
        merged.summary,
        Date.now(),
      );
  }
}
