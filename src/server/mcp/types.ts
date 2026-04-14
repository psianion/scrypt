// src/server/mcp/types.ts
//
// Shared shapes for the MCP tool layer. ToolContext bundles all the
// dependencies tool handlers might need. The context is built once at
// server startup and passed through on every tool dispatch so handlers
// don't reach into module-level globals.
import type { Database } from "bun:sqlite";
import type { ChunkEmbeddingsRepo } from "../embeddings/chunks-repo";
import type { SectionsRepo } from "../indexer/sections-repo";
import type { MetadataRepo } from "../indexer/metadata-repo";
import type {
  EmbeddingService,
  EngineLike,
} from "../embeddings/service";
import type { ProgressBus } from "../embeddings/progress";
import type { Idempotency } from "./idempotency";

export interface ToolContext {
  db: Database;
  sections: SectionsRepo;
  metadata: MetadataRepo;
  embeddings: ChunkEmbeddingsRepo;
  embedService: EmbeddingService;
  engine: EngineLike;
  bus: ProgressBus;
  idempotency: Idempotency;
  userId: string | null;
  vaultDir: string;
}

export interface JsonSchemaProp {
  type: string;
  description?: string;
  enum?: readonly string[];
  items?: JsonSchemaProp;
}

export interface JsonSchema {
  type: string;
  properties?: Record<string, JsonSchemaProp>;
  required?: readonly string[];
  items?: JsonSchemaProp;
  description?: string;
}

export interface ToolDef<TInput = unknown, TOutput = unknown> {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  handler: (
    ctx: ToolContext,
    input: TInput,
    correlationId: string,
  ) => Promise<TOutput>;
}
