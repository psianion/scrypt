// src/server/mcp/tools/find-similar.ts
import { McpError, MCP_ERROR } from "../errors";
import { searchChunks, groupByNote } from "../../embeddings/search";
import type { ToolDef } from "../types";

interface Input {
  path: string;
  limit?: number;
  min_score?: number;
}

interface SimilarResult {
  path: string;
  title: string;
  score: number;
  snippet: string;
  chunk_id: string;
}

interface Output {
  source_path: string;
  results: SimilarResult[];
  model: string;
}

export const findSimilarTool: ToolDef<Input, Output> = {
  name: "find_similar",
  description:
    "Finds notes similar to the given note using its stored chunk vectors.",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string" },
      limit: { type: "number" },
      min_score: { type: "number" },
    },
    required: ["path"],
  },
  async handler(ctx, input) {
    if (process.env.SCRYPT_EMBED_DISABLE === "1") {
      throw new McpError(MCP_ERROR.EMBED_DISABLED, "embedding disabled");
    }
    const limit = input.limit ?? 10;
    const minScore = input.min_score ?? 0.3;
    const sourceChunks = ctx.embeddings.listByNote(
      input.path,
      ctx.engine.model,
    );
    if (sourceChunks.length === 0) {
      throw new McpError(
        MCP_ERROR.NOT_FOUND,
        `no embedding rows for note: ${input.path}`,
      );
    }
    const corpus = ctx.embeddings
      .scanAll(ctx.engine.model)
      .filter((r) => r.note_path !== input.path);

    const allHits = sourceChunks.flatMap((src) =>
      searchChunks(src.vector, corpus, { limit: limit * 3, minScore }),
    );
    const grouped = groupByNote(allHits, limit);
    return {
      source_path: input.path,
      results: grouped.map((g) => ({
        path: g.note_path,
        title: g.note_path,
        score: g.score,
        snippet: g.chunk_text,
        chunk_id: g.chunk_id,
      })),
      model: ctx.engine.model,
    };
  },
};
