// src/server/embeddings/ws-sink.ts
//
// Bridges ProgressBus events onto the scrypt WebSocket manager's
// broadcastChannel method. Kept as a stand-alone function so tests can
// substitute any BroadcastFn without spinning up a real WS server.
import type { ProgressBus, EmbeddingEvent } from "./progress";

export type BroadcastFn = (
  channel: string,
  payload: Record<string, unknown>,
) => void;

export const EMBEDDING_CHANNEL = "vault:embedding";

export function wireWebSocketSink(
  bus: ProgressBus,
  broadcast: BroadcastFn,
): () => void {
  return bus.subscribe((event: EmbeddingEvent) => {
    broadcast(EMBEDDING_CHANNEL, event as unknown as Record<string, unknown>);
  });
}
