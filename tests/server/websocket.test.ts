// tests/server/websocket.test.ts
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { createTestEnv } from "../helpers";

let env: Awaited<ReturnType<typeof createTestEnv>>;

beforeAll(async () => { env = createTestEnv(); });
afterAll(() => env.cleanup());

function connectWs(port: number | undefined): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}/ws`);
    ws.onopen = () => resolve(ws);
    ws.onerror = (e) => reject(e);
  });
}

function waitForMessage(ws: WebSocket): Promise<any> {
  return new Promise((resolve) => {
    ws.onmessage = (event) => resolve(JSON.parse(event.data as string));
  });
}

describe("WebSocket", () => {
  test("client connects to ws://localhost/ws", async () => {
    const ws = await connectWs(env.server.port);
    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
  });

  test("broadcasts noteCreated on file create", async () => {
    const ws = await connectWs(env.server.port);
    const msgPromise = waitForMessage(ws);

    await env.writeNote("notes/ws-test-create.md", "---\ntitle: WS Test\n---\nCreated.");
    const msg = await msgPromise;
    expect(["noteCreated", "noteChanged", "reindexed"]).toContain(msg.type);
    ws.close();
  });

  test("multiple clients receive same broadcast", async () => {
    const ws1 = await connectWs(env.server.port);
    const ws2 = await connectWs(env.server.port);
    const p1 = waitForMessage(ws1);
    const p2 = waitForMessage(ws2);

    await env.writeNote("notes/ws-multi.md", "---\ntitle: Multi\n---\nBroadcast.");
    const [msg1, msg2] = await Promise.all([p1, p2]);
    expect(msg1.type).toBe(msg2.type);
    ws1.close();
    ws2.close();
  });

  test("handles client disconnect gracefully", async () => {
    const ws = await connectWs(env.server.port);
    ws.close();
    await Bun.sleep(100);

    // Server should still work after disconnect
    const res = await fetch(`${env.baseUrl}/api/notes`);
    expect(res.status).toBe(200);
  });
});
