// tests/server/embeddings/service.test.ts
import { test, expect, beforeEach, describe } from "bun:test";
import { Database } from "bun:sqlite";
import { applyWave8Migration } from "../../../src/server/migrations/wave8";
import {
  EmbeddingService,
  type EngineLike,
} from "../../../src/server/embeddings/service";
import { ChunkEmbeddingsRepo } from "../../../src/server/embeddings/chunks-repo";
import {
  ProgressBus,
  type EmbeddingEvent,
} from "../../../src/server/embeddings/progress";
import { parseStructural } from "../../../src/server/indexer/structural-parse";

class FakeEngine implements EngineLike {
  model = "fake-model";
  batchSize = 2;
  embedCalls: string[][] = [];
  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    this.embedCalls.push(texts);
    return texts.map((_, i) => {
      const v = new Float32Array(4);
      v[0] = 1 + i * 0.01;
      let n = 0;
      for (const x of v) n += x * x;
      const norm = Math.sqrt(n);
      for (let j = 0; j < 4; j++) v[j] /= norm;
      return v;
    });
  }
}

const SAMPLE = `---
title: Test
---

## Alpha

alpha body

## Beta

beta body
`;

describe("EmbeddingService", () => {
  let db: Database;
  let repo: ChunkEmbeddingsRepo;
  let bus: ProgressBus;
  let service: EmbeddingService;
  let engine: FakeEngine;

  beforeEach(() => {
    db = new Database(":memory:");
    applyWave8Migration(db);
    repo = new ChunkEmbeddingsRepo(db);
    bus = new ProgressBus();
    engine = new FakeEngine();
    service = new EmbeddingService({
      engine,
      repo,
      bus,
      chunkOpts: { maxTokens: 450, overlapTokens: 50 },
    });
  });

  test("embedNote produces one chunk per section and stores all", async () => {
    const parsed = parseStructural("a.md", SAMPLE);
    const res = await service.embedNote(parsed, "corr-1");
    expect(res.chunks_total).toBe(2);
    expect(res.chunks_embedded).toBe(2);
    expect(repo.listByNote("a.md", engine.model).length).toBe(2);
  });

  test("cache-hit path skips re-embedding unchanged chunks", async () => {
    const parsed = parseStructural("a.md", SAMPLE);
    await service.embedNote(parsed, "corr-1");
    engine.embedCalls.length = 0;
    const res = await service.embedNote(parsed, "corr-2");
    expect(res.chunks_embedded).toBe(2);
    expect(engine.embedCalls.length).toBe(0);
  });

  test("emits parsing, chunking, embedding, stored, done in order", async () => {
    const events: EmbeddingEvent[] = [];
    bus.subscribe((e) => events.push(e));
    const parsed = parseStructural("a.md", SAMPLE);
    await service.embedNote(parsed, "corr-1");
    const phases = events.map((e) => e.phase);
    expect(phases[0]).toBe("parsing");
    expect(phases[1]).toBe("chunking");
    expect(phases).toContain("embedding");
    expect(phases).toContain("stored");
    expect(phases[phases.length - 1]).toBe("done");
  });

  test("deleted sections remove stale chunk rows", async () => {
    const parsed1 = parseStructural("a.md", SAMPLE);
    await service.embedNote(parsed1, "c1");
    const trimmed = `---
title: Test
---

## Alpha

alpha body only
`;
    const parsed2 = parseStructural("a.md", trimmed);
    await service.embedNote(parsed2, "c2");
    const remaining = repo
      .listByNote("a.md", engine.model)
      .map((r) => r.chunk_id);
    expect(remaining).toEqual(["a:alpha"]);
  });
});
