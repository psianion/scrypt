import { test, expect } from "bun:test";
import { EmbedClient, type WorkerLike } from "../../../src/server/embeddings/client";
import type {
  WorkerInbound,
  WorkerOutbound,
} from "../../../src/server/embeddings/worker-protocol";
import type { ProgressBus } from "../../../src/server/embeddings/progress";

class FakeWorker implements WorkerLike {
  private msgListeners: Array<(m: WorkerOutbound) => void> = [];
  private errListeners: Array<(e: Error) => void> = [];
  private readyFired = false;
  public sent: WorkerInbound[] = [];
  public terminated = false;

  postMessage(msg: WorkerInbound) {
    this.sent.push(msg);
  }
  on(event: "message", cb: (m: WorkerOutbound) => void): void;
  on(event: "error", cb: (e: Error) => void): void;
  on(event: "exit", cb: (code: number) => void): void;
  on(event: string, cb: any): void {
    if (event === "message") {
      this.msgListeners.push(cb);
      // Simulate a real worker's worker-ready handshake synchronously so
      // the client flushes any buffered embed-note immediately.
      if (!this.readyFired) {
        this.readyFired = true;
        cb({ type: "worker-ready", model: "fake" });
      }
    }
    if (event === "error") this.errListeners.push(cb);
  }
  terminate() {
    this.terminated = true;
    return Promise.resolve(0);
  }

  // test helpers
  reply(msg: WorkerOutbound) {
    for (const cb of this.msgListeners) cb(msg);
  }
  crash(err: Error) {
    for (const cb of this.errListeners) cb(err);
  }
}

function fakeBus(): ProgressBus {
  return { subscribe: () => () => {}, emit: () => {}, emitThrottled: () => {} } as any;
}

test("EmbedClient: embedNote resolves on embed-done", async () => {
  const fake = new FakeWorker();
  const client = new EmbedClient({
    spawn: () => fake,
    bus: fakeBus(),
    requestTimeoutMs: 1000,
  });

  const promise = client.embedNote(
    { notePath: "a.md", contentHash: "h" } as any,
    "corr-1",
  );

  expect(fake.sent.length).toBe(1);
  expect(fake.sent[0].type).toBe("embed-note");
  const requestId =
    fake.sent[0].type === "embed-note" ? fake.sent[0].requestId : "";
  expect(requestId.length).toBeGreaterThan(0);

  fake.reply({
    type: "embed-done",
    requestId,
    chunksTotal: 4,
    chunksEmbedded: 4,
    chunksSkipped: 0,
    embedMs: 50,
  });

  const result = await promise;
  expect(result).toEqual({ chunks_total: 4, chunks_embedded: 4, embed_ms: 50 });
});

test("EmbedClient: rejects on per-request worker-error", async () => {
  const fake = new FakeWorker();
  const client = new EmbedClient({
    spawn: () => fake,
    bus: fakeBus(),
    requestTimeoutMs: 1000,
  });

  const promise = client.embedNote({} as any, "c");
  const requestId =
    fake.sent[0].type === "embed-note" ? fake.sent[0].requestId : "";

  fake.reply({
    type: "worker-error",
    requestId,
    message: "embed failed",
  });

  await expect(promise).rejects.toThrow("embed failed");
});

test("EmbedClient: rejects on timeout", async () => {
  const fake = new FakeWorker();
  const client = new EmbedClient({
    spawn: () => fake,
    bus: fakeBus(),
    requestTimeoutMs: 50,
  });

  const promise = client.embedNote({} as any, "c");

  await expect(promise).rejects.toThrow(/embed timeout/i);
});

test("EmbedClient: worker hard-error rejects all in-flight and restarts", async () => {
  let spawnCount = 0;
  let lastFake!: FakeWorker;
  const client = new EmbedClient({
    spawn: () => {
      spawnCount += 1;
      lastFake = new FakeWorker();
      return lastFake;
    },
    bus: fakeBus(),
    requestTimeoutMs: 1000,
  });

  const p1 = client.embedNote({} as any, "c1");
  const p2 = client.embedNote({} as any, "c2");
  expect(spawnCount).toBe(1);

  // Capture rejections eagerly so both promises already have handlers
  // when the synchronous crash fires.
  const caught1 = p1.then(
    () => null,
    (e) => e as Error,
  );
  const caught2 = p2.then(
    () => null,
    (e) => e as Error,
  );

  lastFake.crash(new Error("worker died"));

  const e1 = await caught1;
  const e2 = await caught2;
  expect(e1?.message).toMatch(/worker died/);
  expect(e2?.message).toMatch(/worker died/);

  const p3 = client.embedNote({} as any, "c3");
  expect(spawnCount).toBe(2);

  const requestId =
    lastFake.sent[0].type === "embed-note" ? lastFake.sent[0].requestId : "";
  lastFake.reply({
    type: "embed-done",
    requestId,
    chunksTotal: 0,
    chunksEmbedded: 0,
    chunksSkipped: 0,
    embedMs: 0,
  });
  await p3;
});

test("EmbedClient: circuit breaker opens after 3 restarts in 30s", async () => {
  let spawnCount = 0;
  const fakes: FakeWorker[] = [];
  const client = new EmbedClient({
    spawn: () => {
      spawnCount += 1;
      const f = new FakeWorker();
      fakes.push(f);
      return f;
    },
    bus: fakeBus(),
    requestTimeoutMs: 1000,
    breakerThreshold: 3,
    breakerWindowMs: 30_000,
  });

  for (let i = 0; i < 3; i++) {
    const p = client.embedNote({} as any, `c${i}`);
    fakes[fakes.length - 1].crash(new Error("die"));
    await expect(p).rejects.toThrow();
  }

  const before = spawnCount;
  await expect(client.embedNote({} as any, "c4")).rejects.toThrow(
    /embed worker unavailable/i,
  );
  expect(spawnCount).toBe(before);
});

test("EmbedClient: forwards embed-progress events to ProgressBus.emit", async () => {
  const fake = new FakeWorker();
  const emitted: any[] = [];
  const client = new EmbedClient({
    spawn: () => fake,
    bus: { subscribe: () => () => {}, emit: (e: any) => emitted.push(e), emitThrottled: () => {} } as any,
    requestTimeoutMs: 1000,
  });

  const promise = client.embedNote({} as any, "c");
  const requestId =
    fake.sent[0].type === "embed-note" ? fake.sent[0].requestId : "";

  fake.reply({
    type: "embed-progress",
    event: {
      type: "embedding_progress",
      correlation_id: "c",
      note_path: "x.md",
      phase: "embedding",
      chunk_id: "chunk-1",
      chunk_range: [0, 5],
    } as any,
  });

  expect(emitted.length).toBe(1);
  expect(emitted[0].chunk_id).toBe("chunk-1");

  // Resolve the pending request to prevent timer leak
  fake.reply({
    type: "embed-done",
    requestId,
    chunksTotal: 0,
    chunksEmbedded: 0,
    chunksSkipped: 0,
    embedMs: 0,
  });
  await promise;
});
