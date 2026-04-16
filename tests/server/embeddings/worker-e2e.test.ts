import { test, expect } from "bun:test";
import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { EmbedClient } from "../../../src/server/embeddings/client";
import { ProgressBus } from "../../../src/server/embeddings/progress";
import { parseStructural } from "../../../src/server/indexer/structural-parse";

const SKIP =
  process.env.SCRYPT_EMBED_DISABLE === "1" ||
  process.env.SCRYPT_E2E_SKIP_EMBED === "1";

test.skipIf(SKIP)(
  "e2e: real worker embeds a note and replies embed-done",
  async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), "scrypt-e2e-cache-"));
    const dbDir = mkdtempSync(join(tmpdir(), "scrypt-e2e-db-"));

    const here = dirname(fileURLToPath(import.meta.url));
    const workerPath = join(
      here,
      "..",
      "..",
      "..",
      "src",
      "server",
      "embeddings",
      "worker.ts",
    );

    const bus = new ProgressBus();
    const events: any[] = [];
    bus.subscribe((e) => events.push(e));

    const dbPath = join(dbDir, "scrypt.db");
    const client = new EmbedClient({
      spawn: () =>
        new Worker(workerPath, {
          workerData: {
            dbPath,
            cacheDir,
            model: "Xenova/bge-small-en-v1.5",
            batchSize: 4,
            maxTokens: 450,
            overlapTokens: 50,
          },
        }) as any,
      bus,
      requestTimeoutMs: 60_000,
    });

    // Randomize the body so the worker's hasFreshChunk fast-path can't
    // short-circuit on a prior-run DB (or a stale SCRYPT_DB_PATH leaked
    // by an earlier test file). A unique content_hash guarantees the
    // EmbeddingService actually runs the pipeline and emits per-chunk
    // progress events.
    const unique = `${Date.now()}-${Math.random()}`;
    const parsed = parseStructural(
      "test.md",
      `# Hello ${unique}\n\nThis is a small note for the embed worker e2e test.\n`,
    );

    const result = await client.embedNote(parsed, "e2e-corr");

    expect(result.chunks_total).toBeGreaterThan(0);
    expect(result.chunks_embedded).toBe(result.chunks_total);
    expect(result.embed_ms).toBeGreaterThanOrEqual(0);

    // Per-chunk progress events are emitted via ProgressBus.emitThrottled,
    // which coalesces them behind a setTimeout. Poll briefly to let the
    // worker's throttle timer flush and forward the events to us.
    const deadline = Date.now() + 2000;
    while (
      !events.some((e) => e.type === "embedding_progress") &&
      Date.now() < deadline
    ) {
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(events.some((e) => e.type === "embedding_progress")).toBe(true);

    client.shutdown();
  },
  120_000,
);
