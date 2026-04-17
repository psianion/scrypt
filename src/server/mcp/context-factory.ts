// src/server/mcp/context-factory.ts
//
// Builds the shared ToolContext used by MCP transports. One per process.
import { Database } from "bun:sqlite";
import { initSchema } from "../db";
import { SectionsRepo } from "../indexer/sections-repo";
import { MetadataRepo } from "../indexer/metadata-repo";
import { TasksRepo } from "../indexer/tasks-repo";
import { ChunkEmbeddingsRepo } from "../embeddings/chunks-repo";
import { EmbeddingEngine } from "../embeddings/engine";
import { EmbeddingService } from "../embeddings/service";
import { ProgressBus } from "../embeddings/progress";
import { Idempotency } from "./idempotency";
import type { ToolContext } from "./types";

interface ContextFactoryOptions {
  dbPath: string;
  vaultDir: string;
  model: string;
  cacheDir: string;
  batchSize: number;
  chunkMaxTokens: number;
  chunkOverlap: number;
}

function buildContext(
  opts: ContextFactoryOptions,
  userId: string | null,
): ToolContext {
  const db = new Database(opts.dbPath, { create: true });
  initSchema(db);

  const sections = new SectionsRepo(db);
  const metadata = new MetadataRepo(db);
  const tasks = new TasksRepo(db);
  const embeddings = new ChunkEmbeddingsRepo(db);
  const bus = new ProgressBus();
  const engine = new EmbeddingEngine({
    model: opts.model,
    batchSize: opts.batchSize,
    cacheDir: opts.cacheDir,
  });
  const embedService = new EmbeddingService({
    engine,
    repo: embeddings,
    bus,
    chunkOpts: {
      maxTokens: opts.chunkMaxTokens,
      overlapTokens: opts.chunkOverlap,
    },
  });
  const idempotency = new Idempotency(db);

  return {
    db,
    sections,
    metadata,
    tasks,
    embeddings,
    embedService,
    engine,
    bus,
    idempotency,
    userId,
    vaultDir: opts.vaultDir,
  };
}

export function buildContextFromEnv(userId: string | null): ToolContext {
  return buildContext(
    {
      dbPath: process.env.SCRYPT_DB_PATH ?? "./scrypt.db",
      vaultDir: process.env.SCRYPT_VAULT_DIR ?? "./vault",
      model: process.env.SCRYPT_EMBED_MODEL ?? "Xenova/bge-small-en-v1.5",
      cacheDir: process.env.SCRYPT_EMBED_CACHE_DIR ?? "./.embed-cache",
      batchSize: Number(process.env.SCRYPT_EMBED_BATCH ?? 8),
      chunkMaxTokens: Number(process.env.SCRYPT_EMBED_MAX_TOKENS ?? 450),
      chunkOverlap: Number(process.env.SCRYPT_EMBED_OVERLAP ?? 50),
    },
    userId,
  );
}
