// src/server/mcp/tools/semantic-search.ts
import { McpError, MCP_ERROR } from "../errors";
import { searchChunks, groupByNote } from "../../embeddings/search";
import type { ToolDef } from "../types";
import { DOC_TYPES, type DocType } from "../../vocab/doc-types";

interface Input {
  query: string;
  limit?: number;
  folder?: string;
  min_score?: number;
  /** ingest-v3: restrict results to a single project. */
  project?: string;
  /** ingest-v3: restrict results to a single doc_type. */
  doc_type?: DocType;
  /** ingest-v3: restrict results to a single thread. */
  thread?: string;
}

interface SearchResult {
  path: string;
  title: string;
  score: number;
  snippet: string;
  chunk_id: string;
  chunk_range: [number, number];
  project: string | null;
  doc_type: string | null;
  thread: string | null;
}

interface Output {
  results: SearchResult[];
  model: string;
}

interface NoteMeta {
  path: string;
  title: string | null;
  project: string | null;
  doc_type: string | null;
  thread: string | null;
}

export const semanticSearchTool: ToolDef<Input, Output> = {
  name: "semantic_search",
  description:
    "Embeds the query and returns notes whose chunks are most similar by cosine. Supports project/doc_type/thread filters (ingest-v3).",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string" },
      limit: { type: "number" },
      folder: { type: "string" },
      min_score: { type: "number" },
      project: { type: "string" },
      doc_type: { type: "string", enum: [...DOC_TYPES] },
      thread: { type: "string" },
    },
    required: ["query"],
  },
  async handler(ctx, input) {
    if (process.env.SCRYPT_EMBED_DISABLE === "1") {
      throw new McpError(
        MCP_ERROR.EMBED_DISABLED,
        "embedding disabled via SCRYPT_EMBED_DISABLE",
      );
    }
    const limit = input.limit ?? 20;
    const minScore = input.min_score ?? 0.3;
    let vectors: Float32Array[];
    try {
      vectors = await ctx.engine.embedBatch([input.query]);
    } catch (err) {
      throw new McpError(
        MCP_ERROR.EMBED_UNAVAILABLE,
        `embedding model failed: ${err}`,
      );
    }
    const rows = ctx.embeddings.scanAll(ctx.engine.model);
    const hits = searchChunks(vectors[0], rows, {
      limit: limit * 5,
      minScore,
    });
    let grouped = groupByNote(hits, limit);
    if (input.folder) {
      grouped = grouped.filter((g) => g.note_path.startsWith(input.folder!));
    }

    // ingest-v3: join against notes so we can expose project/doc_type/thread
    // and apply those as filters post-hoc. We only look up the paths that made
    // it into `grouped` to keep this cheap.
    const paths = grouped.map((g) => g.note_path);
    const metaByPath = new Map<string, NoteMeta>();
    if (paths.length > 0) {
      const placeholders = paths.map(() => "?").join(",");
      const metas = ctx.db
        .query<NoteMeta, string[]>(
          `SELECT path, title, project, doc_type, thread
             FROM notes
            WHERE path IN (${placeholders})`,
        )
        .all(...paths);
      for (const m of metas) metaByPath.set(m.path, m);
    }

    const filtered = grouped.filter((g) => {
      const m = metaByPath.get(g.note_path);
      if (input.project && m?.project !== input.project) return false;
      if (input.doc_type && m?.doc_type !== input.doc_type) return false;
      if (input.thread && m?.thread !== input.thread) return false;
      return true;
    });

    return {
      results: filtered.map((g) => {
        const m = metaByPath.get(g.note_path);
        return {
          path: g.note_path,
          title: m?.title ?? g.note_path,
          score: g.score,
          snippet: g.chunk_text,
          chunk_id: g.chunk_id,
          chunk_range: [g.start_line, g.end_line] as [number, number],
          project: m?.project ?? null,
          doc_type: m?.doc_type ?? null,
          thread: m?.thread ?? null,
        };
      }),
      model: ctx.engine.model,
    };
  },
};
