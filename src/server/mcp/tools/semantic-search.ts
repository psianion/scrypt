// src/server/mcp/tools/semantic-search.ts
import { McpError, MCP_ERROR } from "../errors";
import { searchChunks, groupByNote } from "../../embeddings/search";
import type { ToolDef } from "../types";

interface Input {
  query: string;
  limit?: number;
  tag?: string;
  folder?: string;
  min_score?: number;
}

interface SearchResult {
  path: string;
  title: string;
  score: number;
  snippet: string;
  chunk_id: string;
  chunk_range: [number, number];
}

interface Output {
  results: SearchResult[];
  model: string;
}

export const semanticSearchTool: ToolDef<Input, Output> = {
  name: "semantic_search",
  description:
    "Embeds the query and returns notes whose chunks are most similar by cosine.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string" },
      limit: { type: "number" },
      tag: { type: "string" },
      folder: { type: "string" },
      min_score: { type: "number" },
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
    if (input.tag) {
      const tag = input.tag;
      grouped = grouped.filter((g) => {
        const m = ctx.metadata.get(g.note_path);
        return !!m?.auto_tags?.includes(tag);
      });
    }
    return {
      results: grouped.map((g) => ({
        path: g.note_path,
        title: g.note_path,
        score: g.score,
        snippet: g.chunk_text,
        chunk_id: g.chunk_id,
        chunk_range: [g.start_line, g.end_line] as [number, number],
      })),
      model: ctx.engine.model,
    };
  },
};
