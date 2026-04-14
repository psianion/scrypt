// tests/server/scripts/reindex.test.ts
import { test, expect, afterEach, describe } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initSchema } from "../../../src/server/db";
import { reindexVault } from "../../../src/server/embeddings/reindex";
import { SectionsRepo } from "../../../src/server/indexer/sections-repo";
import { ChunkEmbeddingsRepo } from "../../../src/server/embeddings/chunks-repo";
import { MetadataRepo } from "../../../src/server/indexer/metadata-repo";
import {
  EmbeddingService,
  type EngineLike,
} from "../../../src/server/embeddings/service";
import { ProgressBus } from "../../../src/server/embeddings/progress";

class FakeEngine implements EngineLike {
  model = "fake";
  batchSize = 4;
  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    return texts.map(() => {
      const v = new Float32Array(4);
      v[0] = 1;
      return v;
    });
  }
}

describe("reindexVault", () => {
  let vaultDir: string;

  afterEach(() => {
    if (vaultDir) rmSync(vaultDir, { recursive: true, force: true });
  });

  test("processes every markdown file and populates chunks", async () => {
    vaultDir = mkdtempSync(join(tmpdir(), "reindex-"));
    mkdirSync(join(vaultDir, "a"), { recursive: true });
    writeFileSync(join(vaultDir, "a/one.md"), `## S1\n\nbody one\n`);
    writeFileSync(join(vaultDir, "two.md"), `## S1\n\nbody two\n`);

    const db = new Database(":memory:");
    initSchema(db);
    const sections = new SectionsRepo(db);
    const metadata = new MetadataRepo(db);
    const embeddings = new ChunkEmbeddingsRepo(db);
    const bus = new ProgressBus();
    const engine = new FakeEngine();
    const svc = new EmbeddingService({
      engine,
      repo: embeddings,
      bus,
      chunkOpts: { maxTokens: 450, overlapTokens: 50 },
    });

    const result = await reindexVault({
      vaultDir,
      db,
      sections,
      metadata,
      embedService: svc,
      engine,
    });

    expect(result.processed).toBe(2);
    expect(embeddings.countByModel("fake")).toBe(2);
  });

  test("skips hidden directories like .scrypt", async () => {
    vaultDir = mkdtempSync(join(tmpdir(), "reindex-hidden-"));
    mkdirSync(join(vaultDir, ".scrypt"), { recursive: true });
    writeFileSync(join(vaultDir, ".scrypt/internal.md"), `## X\n\nbody`);
    writeFileSync(join(vaultDir, "real.md"), `## Y\n\nbody`);

    const db = new Database(":memory:");
    initSchema(db);
    const sections = new SectionsRepo(db);
    const metadata = new MetadataRepo(db);
    const embeddings = new ChunkEmbeddingsRepo(db);
    const bus = new ProgressBus();
    const engine = new FakeEngine();
    const svc = new EmbeddingService({
      engine,
      repo: embeddings,
      bus,
      chunkOpts: { maxTokens: 450, overlapTokens: 50 },
    });

    const result = await reindexVault({
      vaultDir,
      db,
      sections,
      metadata,
      embedService: svc,
      engine,
    });
    expect(result.processed).toBe(1);
  });
});
