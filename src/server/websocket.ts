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
