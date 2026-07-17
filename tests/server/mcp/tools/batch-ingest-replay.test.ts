// tests/server/mcp/tools/batch-ingest-replay.test.ts
//
// Replay regression: a second batch_ingest with the same client_tag must
// report skip, not re-ingest. Broke once because the replay flag was
// serialized into the idempotency cache and came back on cache hits.
import { test, expect, beforeEach, afterEach, describe } from "bun:test";
import { Database } from "bun:sqlite";
import { rmSync, mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initSchema } from "../../../../src/server/db";
import { SectionsRepo } from "../../../../src/server/indexer/sections-repo";
import { MetadataRepo } from "../../../../src/server/indexer/metadata-repo";
import { TasksRepo } from "../../../../src/server/indexer/tasks-repo";
import { ChunkEmbeddingsRepo } from "../../../../src/server/embeddings/chunks-repo";
import {
  EmbeddingService,
  type EngineLike,
} from "../../../../src/server/embeddings/service";
import { ProgressBus } from "../../../../src/server/embeddings/progress";
import { Idempotency } from "../../../../src/server/mcp/idempotency";
import { batchIngestTool } from "../../../../src/server/mcp/tools/batch-ingest";
import type { ToolContext } from "../../../../src/server/mcp/types";

class FakeEngine implements EngineLike {
  model = "fake";
  batchSize = 8;
  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    return texts.map(() => {
      const v = new Float32Array(4);
      v[0] = 1;
      return v;
    });
  }
}

describe("batch_ingest replay", () => {
  let vaultDir: string;
  let sourceDir: string;
  let ctx: ToolContext;

  beforeEach(() => {
    vaultDir = mkdtempSync(join(tmpdir(), "scrypt-vault-"));
    sourceDir = mkdtempSync(join(tmpdir(), "scrypt-ingest-"));
    writeFileSync(join(sourceDir, "one.md"), "# One\n\nbody one\n");
    mkdirSync(join(sourceDir, "sub"));
    writeFileSync(join(sourceDir, "sub", "two.md"), "# Two\n\nbody two\n");

    const db = new Database(":memory:");
    initSchema(db);
    const sections = new SectionsRepo(db);
    const embeddings = new ChunkEmbeddingsRepo(db);
    const bus = new ProgressBus();
    const engine = new FakeEngine();
    const embedService = new EmbeddingService({
      engine,
      repo: embeddings,
      bus,
      chunkOpts: { maxTokens: 450, overlapTokens: 50 },
    });
    ctx = {
      db,
      sections,
      metadata: new MetadataRepo(db),
      tasks: new TasksRepo(db),
      embeddings,
      embedService,
      engine,
      bus,
      idempotency: new Idempotency(db),
      userId: "u1",
      vaultDir,
      scheduleGraphRebuild: () => {},
    };
  });

  afterEach(() => {
    rmSync(vaultDir, { recursive: true, force: true });
    rmSync(sourceDir, { recursive: true, force: true });
  });

  test("second run with same client_tag skips everything", async () => {
    const input = {
      source_dir: sourceDir,
      project: "proj",
      client_tag: "replay-tag",
    };

    const first = await batchIngestTool.handler(ctx, input, "corr-1");
    expect(first.scanned).toBe(2);
    expect(first.ingested).toBe(2);
    expect(first.skipped).toBe(0);

    const second = await batchIngestTool.handler(ctx, input, "corr-2");
    expect(second.scanned).toBe(2);
    expect(second.ingested).toBe(0);
    expect(second.skipped).toBe(2);
    expect(second.files.every((f) => f.status === "skip")).toBe(true);
    // cached replies still carry the vault path so callers can resolve notes
    expect(second.files.map((f) => f.vault_path).sort()).toEqual([
      "projects/proj/research/one.md",
      "projects/proj/research/sub-two.md",
    ]);
  });
});
