// src/client/embedding-ws.ts
//
// Bridges vault:embedding messages from the shared WebSocket into the
// Zustand progress store. Called once at app boot after the socket is
// open.
import { useEmbeddingProgress } from "./stores/embeddingProgress";

interface EmbeddingWsMessage {
  channel: string;
  type: string;
}

export function initEmbeddingProgressBridge(ws: WebSocket): void {
  ws.addEventListener("message", (ev) => {
    try {
      const msg = JSON.parse(String(ev.data)) as EmbeddingWsMessage;
      if (
        msg.channel === "vault:embedding" &&
        msg.type === "embedding_progress"
      ) {
        // The server shape matches EmbeddingEvent minus the channel key,
        // which the store ignores.
        useEmbeddingProgress
          .getState()
          .onEvent(msg as unknown as Parameters<
            typeof useEmbeddingProgress.getState extends () => {
              onEvent: (e: infer E) => void;
            }
              ? (e: E) => void
              : never
          >[0]);
      }
    } catch {
      // ignore malformed frames
    }
  });
}
