// tests/server/embeddings/progress.test.ts
import { test, expect, describe } from "bun:test";
import {
  ProgressBus,
  type EmbeddingEvent,
} from "../../../src/server/embeddings/progress";

describe("ProgressBus", () => {
  test("subscribers receive every emitted event", () => {
    const bus = new ProgressBus();
    const received: EmbeddingEvent[] = [];
    bus.subscribe((e) => received.push(e));
    bus.emit({
      type: "embedding_progress",
      correlation_id: "c",
      note_path: "a.md",
      phase: "parsing",
    });
    bus.emit({
      type: "embedding_progress",
      correlation_id: "c",
      note_path: "a.md",
      phase: "done",
    });
    expect(received.length).toBe(2);
    expect(received[1].phase).toBe("done");
  });

  test("unsubscribe stops delivery", () => {
    const bus = new ProgressBus();
    const received: EmbeddingEvent[] = [];
    const unsub = bus.subscribe((e) => received.push(e));
    bus.emit({
      type: "embedding_progress",
      correlation_id: "c",
      note_path: "a.md",
      phase: "parsing",
    });
    unsub();
    bus.emit({
      type: "embedding_progress",
      correlation_id: "c",
      note_path: "a.md",
      phase: "done",
    });
    expect(received.length).toBe(1);
  });

  test("throttled emit coalesces within the window and flushes the last event", async () => {
    const bus = new ProgressBus({ coalesceMs: 30 });
    const received: EmbeddingEvent[] = [];
    bus.subscribe((e) => received.push(e));
    for (let i = 0; i < 5; i++) {
      bus.emitThrottled({
        type: "embedding_progress",
        correlation_id: "c",
        note_path: "a.md",
        phase: "embedding",
        chunk_index: i,
        chunk_total: 5,
      });
    }
    await new Promise((r) => setTimeout(r, 80));
    expect(received.length).toBeGreaterThanOrEqual(1);
    expect(received.length).toBeLessThanOrEqual(3);
    const last = received[received.length - 1];
    expect(last.chunk_index).toBe(4);
  });
});
