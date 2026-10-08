// src/server/mcp/context-factory.ts
//
// Builds the shared ToolContext used by MCP transports. One per process.
import { join, resolve } from "node:path";
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
import { SnapshotScheduler } from "../graph/snapshot-scheduler";
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
  // The stdio bridge shares this database with a running server: WAL plus a
  // busy timeout keeps the two from tripping over each other's writes.
  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA busy_timeout = 5000");
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
  const snapshotScheduler = new SnapshotScheduler(db, opts.vaultDir);

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
    scheduleGraphRebuild: () => snapshotScheduler.schedule(),
  };
}

/**
 * The same layout the server uses, so a stdio bridge started from the repo
 * (`scrypt mcp install --transport stdio`, or any client's config) finds the
 * vault the server indexes instead of creating an empty one next to it:
 * vault from SCRYPT_VAULT_DIR or SCRYPT_VAULT_PATH (else cwd), everything
 * else under <vault>/.scrypt unless overridden explicitly.
 */
export function resolveMcpEnv(
  env: Record<string, string | undefined>,
  cwd: string,
): ContextFactoryOptions {
  const vaultDir = resolve(env.SCRYPT_VAULT_DIR ?? env.SCRYPT_VAULT_PATH ?? cwd);
  const scryptDir = join(vaultDir, ".scrypt");
  return {
    dbPath: env.SCRYPT_DB_PATH ?? join(scryptDir, "scrypt.db"),
    vaultDir,
    model: env.SCRYPT_EMBED_MODEL ?? "Xenova/bge-small-en-v1.5",
    cacheDir: env.SCRYPT_EMBED_CACHE_DIR ?? join(scryptDir, "embed-cache"),
    batchSize: Number(env.SCRYPT_EMBED_BATCH ?? 8),
    chunkMaxTokens: Number(env.SCRYPT_EMBED_MAX_TOKENS ?? 450),
    chunkOverlap: Number(env.SCRYPT_EMBED_OVERLAP ?? 50),
  };
}

export function buildContextFromEnv(userId: string | null): ToolContext {
  return buildContext(resolveMcpEnv(process.env, process.cwd()), userId);
}
