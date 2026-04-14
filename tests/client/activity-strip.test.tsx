// tests/client/activity-strip.test.tsx
import { test, expect, beforeEach, afterEach, describe } from "bun:test";
import { render, screen, cleanup, act } from "@testing-library/react";
import { ActivityStrip } from "../../src/client/components/ActivityStrip";
import { useEmbeddingProgress } from "../../src/client/stores/embeddingProgress";

describe("ActivityStrip", () => {
  beforeEach(() => {
    useEmbeddingProgress.setState({ inFlight: {} });
  });
  afterEach(() => {
    cleanup();
  });

  test("renders nothing when no in-flight entries", () => {
    render(<ActivityStrip />);
    expect(screen.queryByTestId("activity-strip")).toBeNull();
  });

  test("renders a row when an embedding event fires", () => {
    render(<ActivityStrip />);
    act(() => {
      useEmbeddingProgress.getState().onEvent({
        type: "embedding_progress",
        correlation_id: "c",
        note_path: "notes/x.md",
        phase: "chunking",
        chunk_total: 4,
      });
    });
    expect(screen.getByTestId("activity-strip")).toBeTruthy();
    expect(screen.getByTestId("activity-notes/x.md")).toBeTruthy();
    expect(screen.getByText("0/4")).toBeTruthy();
  });

  test("removes the row after done + 3s dismissal", async () => {
    render(<ActivityStrip />);
    act(() => {
      const api = useEmbeddingProgress.getState();
      api.onEvent({
        type: "embedding_progress",
        correlation_id: "c",
        note_path: "n.md",
        phase: "chunking",
        chunk_total: 1,
      });
      api.onEvent({
        type: "embedding_progress",
        correlation_id: "c",
        note_path: "n.md",
        phase: "done",
      });
    });
    expect(screen.getByTestId("activity-n.md")).toBeTruthy();
    await new Promise((r) => setTimeout(r, 3150));
    expect(screen.queryByTestId("activity-n.md")).toBeNull();
  }, 5000);
});
