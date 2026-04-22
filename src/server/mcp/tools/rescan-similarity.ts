// src/server/mcp/tools/rescan-similarity.ts
//
// Idempotent semantic-similarity scan over an arbitrary subset of notes.
// Useful after a single create_note ingest where the skill wants new edges
// without paying the full batch_ingest cost. Spec §4.2 step 3.
import { McpError, MCP_ERROR } from "../errors";
import type { ToolDef } from "../types";
import {
  findSimilarPairs,
  upsertSemanticEdges,
  getSimilarityThreshold,
} from "../../graph/semantic-similarity";

interface Input {
  /** When set, only emit pairs that include at least one of these paths. */
  paths?: string[];
  /** Cosine threshold; defaults to SCRYPT_SIMILARITY_THRESHOLD env (0.75). */
  min_similarity?: number;
  /** Embedding model to scan; defaults to SCRYPT_EMBED_MODEL env. */
  model?: string;
}

interface Output {
  edges_created: number;
  pairs_considered: number;
  threshold: number;
  model: string;
}

const DEFAULT_MODEL = "Xenova/bge-small-en-v1.5";

export const rescanSimilarityTool: ToolDef<Input, Output> = {
  name: "rescan_similarity",
  description:
    "Scan note chunk embeddings and emit `tier='semantically_related'` edges for note pairs above the cosine threshold. Idempotent — duplicates are skipped via UNIQUE(source,target,tier). When `paths` is provided, only pairs touching one of those paths are emitted.",
  inputSchema: {
    type: "object",
    properties: {
      paths: {
        type: "array",
        items: { type: "string" },
        description: "Optional scope: emit pairs that include one of these paths.",
      },
      min_similarity: { type: "number" },
      model: { type: "string" },
    },
  },
  async handler(ctx, input) {
    const threshold = input.min_similarity ?? getSimilarityThreshold();
    if (threshold < 0 || threshold > 1) {
      throw new McpError(
        MCP_ERROR.INVALID_PARAMS,
        `min_similarity must be in [0, 1] (got ${threshold})`,
      );
    }
    const model = input.model ?? process.env.SCRYPT_EMBED_MODEL ?? DEFAULT_MODEL;
    const allPaths = (
      ctx.db
        .query<{ note_path: string }, [string]>(
          `SELECT DISTINCT note_path FROM note_chunk_embeddings WHERE model = ?`,
        )
        .all(model)
    ).map((r) => r.note_path);

    if (allPaths.length < 2) {
      return {
        edges_created: 0,
        pairs_considered: 0,
        threshold,
        model,
      };
    }

    const scoped = input.paths && input.paths.length > 0 ? new Set(input.paths) : undefined;
    const pairs = findSimilarPairs(ctx.db, allPaths, model, {
      minSimilarity: threshold,
      scopedTo: scoped,
    });
    const created = upsertSemanticEdges(ctx.db, pairs);
    ctx.scheduleGraphRebuild();
    return {
      edges_created: created,
      pairs_considered: pairs.length,
      threshold,
      model,
    };
  },
};
