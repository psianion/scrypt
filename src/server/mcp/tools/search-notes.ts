// src/server/mcp/tools/search-notes.ts
import type { ToolDef } from "../types";

interface Input {
  query: string;
  limit?: number;
  tag?: string;
  folder?: string;
}

interface FtsRow {
  path: string;
  title: string;
  snippet: string;
  score: number;
}

interface Output {
  results: FtsRow[];
}

export const searchNotesTool: ToolDef<Input, Output> = {
  name: "search_notes",
  description:
    "Keyword search via SQLite FTS5. Fast and exact; use for queries with specific terms.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string" },
      limit: { type: "number" },
      tag: { type: "string" },
      folder: { type: "string" },
    },
    required: ["query"],
  },
  async handler(ctx, input) {
    const limit = input.limit ?? 20;
    const folderClause = input.folder ? "AND notes.path LIKE ?" : "";
    const sql = `
      SELECT notes.path AS path,
             notes.title AS title,
             snippet(notes_fts, -1, '<mark>', '</mark>', '...', 16) AS snippet,
             bm25(notes_fts) AS score
      FROM notes_fts
      JOIN notes ON notes.id = notes_fts.rowid
      WHERE notes_fts MATCH ?
      ${folderClause}
      ORDER BY score ASC
      LIMIT ?
    `;
    const rows = input.folder
      ? ctx.db
          .query<FtsRow, [string, string, number]>(sql)
          .all(input.query, `${input.folder}%`, limit)
      : ctx.db
          .query<FtsRow, [string, number]>(sql)
          .all(input.query, limit);
    return { results: rows };
  },
};
