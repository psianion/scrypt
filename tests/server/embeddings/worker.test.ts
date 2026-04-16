import { test, expect } from "bun:test";
import {
  handleWorkerMessage,
  resolveBootstrapConfig,
} from "../../../src/server/embeddings/worker";
import type {
  WorkerInbound,
  WorkerOutbound,
} from "../../../src/server/embeddings/worker-protocol";
import type { EmbedderLike } from "../../../src/server/embeddings/service";
import type { ProgressBus } from "../../../src/server/embeddings/progress";

function makeFakeEmbedder(
  result = { chunks_total: 3, chunks_embedded: 3, embed_ms: 42 },
): EmbedderLike {
  return {
    async embedNote() {
      return result;
    },
  };
}

function makeFakeBus(): ProgressBus {
  return {
    subscribe: (_listener: (e: any) => void) => () => {},
    emit: (_e: any) => {},
    emitThrottled: (_e: any) => {},
  } as unknown as ProgressBus;
}

test("worker: embed-note → embed-done with chunk counts from embedder", async () => {
  const sent: WorkerOutbound[] = [];
  const post = (msg: WorkerOutbound) => sent.push(msg);
  const embedder = makeFakeEmbedder({
    chunks_total: 5,
    chunks_embedded: 5,
    embed_ms: 100,
  });
  const bus = makeFakeBus();

  const job: WorkerInbound = {
    type: "embed-note",
    requestId: "req-1",
    parsed: {
      notePath: "test.md",
      contentHash: "h1",
      title: "Test",
      sections: [],
      body: "",
    } as any,
    correlationId: "corr-1",
  };

  await handleWorkerMessage(job, { embedder, bus, post });

  expect(sent.length).toBe(1);
  expect(sent[0]).toEqual({
    type: "embed-done",
    requestId: "req-1",
    chunksTotal: 5,
    chunksEmbedded: 5,
    chunksSkipped: 0,
    embedMs: 100,
  });
});

test("worker: embedder throws → worker-error reply with requestId", async () => {
  const sent: WorkerOutbound[] = [];
  const post = (msg: WorkerOutbound) => sent.push(msg);
  const embedder: EmbedderLike = {
    async embedNote() {
      throw new Error("boom");
    },
  };
  const bus = makeFakeBus();

  const job: WorkerInbound = {
    type: "embed-note",
    requestId: "req-2",
    parsed: { notePath: "x.md", contentHash: "h" } as any,
    correlationId: "c",
  };

  await handleWorkerMessage(job, { embedder, bus, post });

  expect(sent.length).toBe(1);
  expect(sent[0].type).toBe("worker-error");
  if (sent[0].type === "worker-error") {
    expect(sent[0].requestId).toBe("req-2");
    expect(sent[0].message).toContain("boom");
  }
});

test("worker: prewarm → worker-ready", async () => {
  const sent: WorkerOutbound[] = [];
  const post = (msg: WorkerOutbound) => sent.push(msg);
  const bus = makeFakeBus();
  const embedder = makeFakeEmbedder();

  await handleWorkerMessage(
    { type: "prewarm" },
    { embedder, bus, post, model: "fake-model" },
  );

  expect(sent.length).toBe(1);
  expect(sent[0]).toEqual({ type: "worker-ready", model: "fake-model" });
});

test("resolveBootstrapConfig: honors workerData.dbPath (regression: split-brain DB)", () => {
  // Regression for the phantom-DB bug: the worker previously fell back
  // to "./scrypt.db" in its own CWD when no env var was set, writing
  // embeddings to a file the main thread never reads. The parent must
  // be able to force the dbPath via workerData, and resolveBootstrapConfig
  // must prefer workerData over env over any hardcoded default.
  const cfg = resolveBootstrapConfig(
    { dbPath: "/vault/.scrypt/scrypt.db", model: "m", batchSize: 4, cacheDir: "/c", maxTokens: 100, overlapTokens: 10 },
    {} as NodeJS.ProcessEnv,
  );
  expect(cfg.dbPath).toBe("/vault/.scrypt/scrypt.db");
  expect(cfg.model).toBe("m");
  expect(cfg.batchSize).toBe(4);
  expect(cfg.cacheDir).toBe("/c");
  expect(cfg.maxTokens).toBe(100);
  expect(cfg.overlapTokens).toBe(10);
});

test("resolveBootstrapConfig: workerData takes precedence over env", () => {
  const cfg = resolveBootstrapConfig(
    { dbPath: "/wd.db" },
    { SCRYPT_DB_PATH: "/env.db", SCRYPT_EMBED_MODEL: "env-model" } as unknown as NodeJS.ProcessEnv,
  );
  expect(cfg.dbPath).toBe("/wd.db");
  expect(cfg.model).toBe("env-model");
});

test("resolveBootstrapConfig: throws when dbPath is missing (hard fail, no silent default)", () => {
  expect(() =>
    resolveBootstrapConfig(null, {} as NodeJS.ProcessEnv),
  ).toThrow(/dbPath/);
  expect(() =>
    resolveBootstrapConfig({}, {} as NodeJS.ProcessEnv),
  ).toThrow(/dbPath/);
});
