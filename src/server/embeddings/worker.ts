//
// Worker-thread entrypoint for the embed pipeline. Two layers:
//
//   1. handleWorkerMessage(): pure function, takes deps as parameters,
//      called from both the test harness and the real worker bootstrap.
//   2. bootstrap(): builds real deps and wires parentPort. Only runs
//      when this file is loaded as a worker entry.
import type {
  WorkerInbound,
  WorkerOutbound,
  EmbedJobMessage,
} from "./worker-protocol";
import type { EmbedderLike } from "./service";
import type { ProgressBus } from "./progress";

export interface WorkerDeps {
  embedder: EmbedderLike;
  bus: ProgressBus;
  post: (msg: WorkerOutbound) => void;
  model?: string;
}

export async function handleWorkerMessage(
  msg: WorkerInbound,
  deps: WorkerDeps,
): Promise<void> {
  switch (msg.type) {
    case "prewarm": {
      deps.post({ type: "worker-ready", model: deps.model ?? "unknown" });
      return;
    }
    case "shutdown": {
      return;
    }
    case "embed-note": {
      await runEmbedJob(msg, deps);
      return;
    }
  }
}

async function runEmbedJob(
  msg: EmbedJobMessage,
  deps: WorkerDeps,
): Promise<void> {
  try {
    const result = await deps.embedder.embedNote(msg.parsed, msg.correlationId);
    deps.post({
      type: "embed-done",
      requestId: msg.requestId,
      chunksTotal: result.chunks_total,
      chunksEmbedded: result.chunks_embedded,
      chunksSkipped: result.chunks_total - result.chunks_embedded,
      embedMs: result.embed_ms,
    });
  } catch (err) {
    const e = err as Error;
    deps.post({
      type: "worker-error",
      requestId: msg.requestId,
      message: e.message,
      stack: e.stack,
    });
  }
}

// ---- bootstrap (only runs inside a real worker thread) ----

async function bootstrap() {
  const { parentPort } = await import("node:worker_threads");
  if (!parentPort) return;

  const { Database } = await import("bun:sqlite");
  const { initSchema } = await import("../db");
  const { EmbeddingEngine } = await import("./engine");
  const { ChunkEmbeddingsRepo } = await import("./chunks-repo");
  const { ProgressBus } = await import("./progress");
  const { EmbeddingService } = await import("./service");

  const dbPath = process.env.SCRYPT_DB_PATH ?? "./scrypt.db";
  const db = new Database(dbPath, { create: true });
  initSchema(db);
  db.run("PRAGMA journal_mode = WAL");

  const engine = new EmbeddingEngine({
    model: process.env.SCRYPT_EMBED_MODEL ?? "Xenova/bge-small-en-v1.5",
    batchSize: Number(process.env.SCRYPT_EMBED_BATCH ?? 8),
    cacheDir: process.env.SCRYPT_EMBED_CACHE_DIR ?? "./.embed-cache",
  });
  await engine.prewarm?.();

  const repo = new ChunkEmbeddingsRepo(db);
  const bus = new ProgressBus();
  const embedder = new EmbeddingService({
    engine,
    repo,
    bus,
    chunkOpts: {
      maxTokens: Number(process.env.SCRYPT_EMBED_MAX_TOKENS ?? 450),
      overlapTokens: Number(process.env.SCRYPT_EMBED_OVERLAP ?? 50),
    },
  });

  const post = (msg: WorkerOutbound) => parentPort!.postMessage(msg);

  bus.subscribe((event) => {
    post({ type: "embed-progress", event });
  });

  parentPort.on("message", (msg: WorkerInbound) => {
    if (msg.type === "shutdown") {
      try {
        db.close();
      } catch {}
      process.exit(0);
    }
    handleWorkerMessage(msg, {
      embedder,
      bus,
      post,
      model: engine.model,
    }).catch((err) => {
      post({
        type: "worker-error",
        message: (err as Error).message,
        stack: (err as Error).stack,
      });
    });
  });

  post({ type: "worker-ready", model: engine.model });
}

bootstrap().catch((err) => {
  console.error("[embed-worker] bootstrap failed:", err);
  process.exit(1);
});
