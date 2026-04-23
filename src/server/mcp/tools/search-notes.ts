// src/server/mcp/tools/search-notes.ts
import type { ToolDef } from "../types";
import { DOC_TYPES, type DocType } from "../../vocab/doc-types";

interface Input {
  query: string;
  limit?: number;
  tag?: string;
  folder?: string;
  /** ingest-v3: restrict results to a single project. */
  project?: string;
  /** ingest-v3: restrict results to a single doc_type. */
  doc_type?: DocType;
  /** ingest-v3: restrict results to a single thread. */
  thread?: string;
}

interface FtsRow {
  path: string;
  title: string;
  snippet: string;
  score: number;
  project: string | null;
  doc_type: string | null;
  thread: string | null;
}

interface Output {
  results: FtsRow[];
}

export const searchNotesTool: ToolDef<Input, Output> = {
  name: "search_notes",
  description:
    "Keyword search via SQLite FTS5 with project/doc_type/thread filters. Fast and exact; use for queries with specific terms.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string" },
      limit: { type: "number" },
      tag: { type: "string" },
      folder: { type: "string" },
      project: { type: "string" },
      doc_type: { type: "string", enum: [...DOC_TYPES] },
      thread: { type: "string" },
    },
    required: ["query"],
  },
  async handler(ctx, input) {
    const limit = input.limit ?? 20;
    const wheres: string[] = [];
    const params: Array<string | number> = [input.query];
    if (input.folder) {
      wheres.push("notes.path LIKE ?");
      params.push(`${input.folder}%`);
    }
    if (input.project) {
      wheres.push("notes.project = ?");
      params.push(input.project);
    }
    if (input.doc_type) {
      wheres.push("notes.doc_type = ?");
      params.push(input.doc_type);
    }
    if (input.thread) {
      wheres.push("notes.thread = ?");
      params.push(input.thread);
    }
    const extra = wheres.length > 0 ? "AND " + wheres.join(" AND ") : "";
    params.push(limit);
    const sql = `
      SELECT notes.path AS path,
             notes.title AS title,
             snippet(notes_fts, -1, '<mark>', '</mark>', '...', 16) AS snippet,
             bm25(notes_fts) AS score,
             notes.project AS project,
             notes.doc_type AS doc_type,
             notes.thread AS thread
      FROM notes_fts
      JOIN notes ON notes.id = notes_fts.rowid
      WHERE notes_fts MATCH ?
      ${extra}
      ORDER BY score ASC
      LIMIT ?
    `;
    const rows = ctx.db.query<FtsRow, typeof params>(sql).all(...params);
    return { results: rows };
  },
};
