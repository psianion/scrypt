import { test, expect, beforeAll, afterAll } from "bun:test";
import { HubClient, SyncHttpError } from "../../src/server/sync/hub-client";

let server: ReturnType<typeof Bun.serve>;
let base: string;
let lastCreate: any = null;

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/api/sync/manifest") {
        return Response.json({ notes: [{ path: "a.md", content_hash: "h1" }] });
      }
      if (url.pathname === "/api/sync/note") {
        return new Response("raw-body");
      }
      if (url.pathname === "/mcp") {
        lastCreate = await req.json();
        return Response.json({
          jsonrpc: "2.0",
          id: 1,
          result: { content: [{ type: "text", text: "{}" }] },
        });
      }
      if (url.pathname === "/secure") {
        return new Response("", { status: 401 });
      }
      return new Response("nope", { status: 404 });
    },
  });
  base = `http://localhost:${server.port}`;
});

afterAll(() => server.stop(true));

test("getManifest returns a path->hash map", async () => {
  const map = await new HubClient(base).getManifest();
  expect(map.get("a.md")).toBe("h1");
});

test("getNoteContent returns raw text", async () => {
  expect(await new HubClient(base).getNoteContent("a.md")).toBe("raw-body");
});

test("createNote posts a tools/call create_note request", async () => {
  await new HubClient(base, "tok").createNote("a.md", "content", "tag-1");
  expect(lastCreate.method).toBe("tools/call");
  expect(lastCreate.params.name).toBe("create_note");
  expect(lastCreate.params.arguments).toMatchObject({
    path: "a.md",
    content: "content",
    client_tag: "tag-1",
    allow_nonstandard_path: true,
  });
});

test("a 401 raises a SyncHttpError mentioning the token", async () => {
  const client = new HubClient(base, "tok");
  await expect(client.get("/secure")).rejects.toBeInstanceOf(SyncHttpError);
});

test("an unreachable host raises a clear error", async () => {
  const client = new HubClient("http://127.0.0.1:1", "tok"); // nothing listening
  await expect(client.getManifest()).rejects.toThrow(/unreachable/i);
});
