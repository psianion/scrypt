// tests/client/stores/embedding-progress.test.ts
import { test, expect, beforeEach, describe } from "bun:test";
import { useEmbeddingProgress } from "../../../src/client/stores/embeddingProgress";

describe("embedding progress store", () => {
  beforeEach(() => {
    useEmbeddingProgress.setState({ inFlight: {} });
  });

  test("chunking event seeds an in-flight entry", () => {
    useEmbeddingProgress.getState().onEvent({
      type: "embedding_progress",
      correlation_id: "c",
      note_path: "a.md",
      phase: "chunking",
      chunk_total: 3,
    });
    const entry = useEmbeddingProgress.getState().inFlight["a.md"];
    expect(entry).toBeTruthy();
    expect(entry!.total).toBe(3);
    expect(entry!.storedCount).toBe(0);
  });

  test("stored events increment count and embedding sets active chunk", () => {
    const api = useEmbeddingProgress.getState();
    api.onEvent({
      type: "embedding_progress",
      correlation_id: "c",
      note_path: "a.md",
      phase: "chunking",
      chunk_total: 2,
    });
    api.onEvent({
      type: "embedding_progress",
      correlation_id: "c",
      note_path: "a.md",
      phase: "embedding",
      chunk_id: "s1",
      chunk_index: 0,
      chunk_range: [1, 5],
    });
    let entry = useEmbeddingProgress.getState().inFlight["a.md"];
    expect(entry!.activeChunk).toBe("s1");
    expect(entry!.activeRange).toEqual([1, 5]);

    api.onEvent({
      type: "embedding_progress",
      correlation_id: "c",
      note_path: "a.md",
      phase: "stored",
      chunk_id: "s1",
    });
    entry = useEmbeddingProgress.getState().inFlight["a.md"];
    expect(entry!.storedCount).toBe(1);
  });

  test("done event schedules removal after the dismissal window", async () => {
    const api = useEmbeddingProgress.getState();
    api.onEvent({
      type: "embedding_progress",
      correlation_id: "c",
      note_path: "a.md",
      phase: "chunking",
      chunk_total: 1,
    });
    api.onEvent({
      type: "embedding_progress",
      correlation_id: "c",
      note_path: "a.md",
      phase: "done",
    });
    expect(useEmbeddingProgress.getState().inFlight["a.md"]).toBeTruthy();
    await new Promise((r) => setTimeout(r, 3100));
    expect(useEmbeddingProgress.getState().inFlight["a.md"]).toBeUndefined();
  }, 5000);
});
