// src/server/indexer/sections-repo.ts
//
// CRUD over note_sections — used by the indexer on reindex and by the
// MCP add_section_summary tool.
import type { Database } from "bun:sqlite";

export interface SectionInput {
  id: string;
  headingSlug: string;
  headingText: string;
  level: number;
  startLine: number;
  endLine: number;
}

export interface SectionRow {
  id: string;
  note_path: string;
  heading_slug: string;
  heading_text: string;
  level: number;
  summary: string | null;
  start_line: number;
  end_line: number;
}

export class SectionsRepo {
  constructor(private db: Database) {}

  replaceNoteSections(notePath: string, sections: SectionInput[]): void {
    const del = this.db.prepare(
      `DELETE FROM note_sections WHERE note_path = ?`,
    );
    const ins = this.db.prepare(
      `INSERT INTO note_sections
         (id, note_path, heading_slug, heading_text, level, summary, start_line, end_line)
       VALUES (?, ?, ?, ?, ?, NULL, ?, ?)`,
    );
    const tx = this.db.transaction((rows: SectionInput[]) => {
      del.run(notePath);
      for (const s of rows) {
        ins.run(
          s.id,
          notePath,
          s.headingSlug,
          s.headingText,
          s.level,
          s.startLine,
          s.endLine,
        );
      }
    });
    tx(sections);
  }

  listByNote(notePath: string): SectionRow[] {
    return this.db
      .query<SectionRow, [string]>(
        `SELECT * FROM note_sections WHERE note_path = ? ORDER BY start_line`,
      )
      .all(notePath);
  }

  getById(id: string): SectionRow | null {
    return (
      this.db
        .query<SectionRow, [string]>(
          `SELECT * FROM note_sections WHERE id = ?`,
        )
        .get(id) ?? null
    );
  }

  setSummary(id: string, summary: string): number {
    const res = this.db
      .query(`UPDATE note_sections SET summary = ? WHERE id = ?`)
      .run(summary, id);
    return res.changes;
  }
}
