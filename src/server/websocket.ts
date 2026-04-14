// src/server/websocket.ts
import type { ServerWebSocket } from "bun";
import type { WsMessage } from "../shared/types";

export class WebSocketManager {
  private clients = new Set<ServerWebSocket<unknown>>();

  broadcast(message: WsMessage): void {
    const data = JSON.stringify(message);
    for (const client of this.clients) {
      client.send(data);
    }
  }

  // Wave 8: channel-scoped broadcast for vault:embedding and any future
  // channels that don't fit the strict WsMessage union. Payload is spread
  // alongside `channel` so subscribers can dispatch on the channel name.
  broadcastChannel(channel: string, payload: Record<string, unknown>): void {
    const data = JSON.stringify({ channel, ...payload });
    for (const client of this.clients) {
      try {
        client.send(data);
      } catch {
        // client disconnected between iteration and send; ignore
      }
    }
  }

  handlers() {
    return {
      open: (ws: ServerWebSocket<unknown>) => {
        this.clients.add(ws);
      },
      close: (ws: ServerWebSocket<unknown>) => {
        this.clients.delete(ws);
      },
      message: () => {},
    };
  }
}
