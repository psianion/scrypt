// tests/server/embeddings/ws-sink.test.ts
import { test, expect, describe } from "bun:test";
import { ProgressBus } from "../../../src/server/embeddings/progress";
import {
  wireWebSocketSink,
  EMBEDDING_CHANNEL,
} from "../../../src/server/embeddings/ws-sink";

describe("wireWebSocketSink", () => {
  test("forwards emitted events to the broadcast fn on the embedding channel", () => {
    const bus = new ProgressBus();
    const sent: { channel: string; payload: Record<string, unknown> }[] = [];
    const broadcast = (channel: string, payload: Record<string, unknown>) => {
      sent.push({ channel, payload });
    };
    wireWebSocketSink(bus, broadcast);

    bus.emit({
      type: "embedding_progress",
      correlation_id: "c1",
      note_path: "a.md",
      phase: "done",
    });

    expect(sent.length).toBe(1);
    expect(sent[0].channel).toBe(EMBEDDING_CHANNEL);
    expect(sent[0].payload.phase).toBe("done");
    expect(sent[0].payload.note_path).toBe("a.md");
  });

  test("unwire stops delivery", () => {
    const bus = new ProgressBus();
    const sent: { channel: string; payload: Record<string, unknown> }[] = [];
    const unwire = wireWebSocketSink(bus, (channel, payload) =>
      sent.push({ channel, payload }),
    );

    bus.emit({
      type: "embedding_progress",
      correlation_id: "c1",
      note_path: "a.md",
      phase: "parsing",
    });
    unwire();
    bus.emit({
      type: "embedding_progress",
      correlation_id: "c1",
      note_path: "a.md",
      phase: "done",
    });
    expect(sent.length).toBe(1);
  });
});
