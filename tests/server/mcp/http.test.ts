// tests/server/mcp/http.test.ts
import { test, expect, describe } from "bun:test";
import { handleMcpHttp } from "../../../src/server/mcp/transports/http";
import { ToolRegistry } from "../../../src/server/mcp/registry";
import type { ToolContext } from "../../../src/server/mcp/types";

function makeRegistry() {
  const reg = new ToolRegistry();
  reg.register<{ msg: string }, { echoed: string }>({
    name: "echo",
    description: "",
    inputSchema: {
      type: "object",
      properties: { msg: { type: "string" } },
      required: ["msg"],
    },
    handler: async (_ctx, input) => ({ echoed: input.msg }),
  });
  return reg;
}

const stubCtx = {} as ToolContext;

describe("handleMcpHttp", () => {
  test("POST /mcp tools/list returns registered tools", async () => {
    const reg = makeRegistry();
    const req = new Request("http://x/mcp", {
      method: "POST",
      headers: {
        authorization: "Bearer test-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    const res = await handleMcpHttp(req, reg, stubCtx, async () => "user-1");
    const body = (await res.json()) as { result: { tools: { name: string }[] } };
    expect(res.status).toBe(200);
    expect(body.result.tools[0].name).toBe("echo");
  });

  test("POST /mcp tools/call executes the tool", async () => {
    const reg = makeRegistry();
    const req = new Request("http://x/mcp", {
      method: "POST",
      headers: {
        authorization: "Bearer t",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "echo", arguments: { msg: "hi" } },
      }),
    });
    const res = await handleMcpHttp(req, reg, stubCtx, async () => "user-1");
    const body = (await res.json()) as {
      result: { content: Array<{ type: string; text: string }> };
    };
    expect(body.result.content).toHaveLength(1);
    expect(body.result.content[0].type).toBe("text");
    const inner = JSON.parse(body.result.content[0].text) as { echoed: string };
    expect(inner.echoed).toBe("hi");
  });

  test("initialize includes instructions when a schema doc exists", async () => {
    const reg = makeRegistry();
    const req = new Request("http://x/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
    });
    const res = await handleMcpHttp(
      req, reg, stubCtx, async () => "user-1", undefined,
      () => "# Vault Schema\ndo librarian things",
    );
    const body = (await res.json()) as {
      result: { instructions?: string; serverInfo: { name: string } };
    };
    expect(body.result.serverInfo.name).toBe("scrypt");
    expect(body.result.instructions).toContain("# Vault Schema");
  });

  test("initialize omits instructions when no schema doc", async () => {
    const reg = makeRegistry();
    const req = new Request("http://x/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
    });
    const res = await handleMcpHttp(
      req, reg, stubCtx, async () => "user-1", undefined,
      () => null,
    );
    const body = (await res.json()) as { result: Record<string, unknown> };
    expect("instructions" in body.result).toBe(false);
  });

  test("missing auth returns 401", async () => {
    const reg = makeRegistry();
    const req = new Request("http://x/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    const res = await handleMcpHttp(req, reg, stubCtx, async () => null);
    expect(res.status).toBe(401);
  });

  test("non-POST returns 405", async () => {
    const reg = makeRegistry();
    const req = new Request("http://x/mcp", { method: "GET" });
    const res = await handleMcpHttp(req, reg, stubCtx, async () => "user");
    expect(res.status).toBe(405);
  });

  test("bad json returns INVALID_PARAMS error", async () => {
    const reg = makeRegistry();
    const req = new Request("http://x/mcp", {
      method: "POST",
      headers: {
        authorization: "Bearer t",
        "content-type": "application/json",
      },
      body: "{not json",
    });
    const res = await handleMcpHttp(req, reg, stubCtx, async () => "user");
    expect(res.status).toBe(400);
  });
});

describe("handleMcpHttp protocol compliance", () => {
  const post = (payload: unknown) =>
    new Request("http://x/mcp", {
      method: "POST",
      headers: { authorization: "Bearer t", "content-type": "application/json" },
      body: JSON.stringify(payload),
    });

  test("a notification (no id) gets 202 with an empty body, not a JSON-RPC envelope", async () => {
    const res = await handleMcpHttp(post({ jsonrpc: "2.0", method: "notifications/initialized" }), makeRegistry(), stubCtx, async () => "u");
    expect(res.status).toBe(202);
    expect(await res.text()).toBe("");
  });

  test("initialize negotiates a protocol version the server actually supports", async () => {
    const known = await handleMcpHttp(post({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } }), makeRegistry(), stubCtx, async () => "u");
    expect(((await known.json()) as any).result.protocolVersion).toBe("2025-03-26");
    const future = await handleMcpHttp(post({ jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "2099-01-01" } }), makeRegistry(), stubCtx, async () => "u");
    expect(((await future.json()) as any).result.protocolVersion).toBe("2025-06-18");
  });

  test("an unknown method is the standard JSON-RPC -32601", async () => {
    const res = await handleMcpHttp(post({ jsonrpc: "2.0", id: 3, method: "resources/list" }), makeRegistry(), stubCtx, async () => "u");
    expect(((await res.json()) as any).error.code).toBe(-32601);
  });

  test("tools/list carries title + annotations for known scrypt tools", async () => {
    const reg = new ToolRegistry();
    reg.register({ name: "get_note", description: "", inputSchema: { type: "object" }, handler: async () => ({}) });
    reg.register({ name: "delete_task", description: "", inputSchema: { type: "object" }, handler: async () => ({}) });
    const res = await handleMcpHttp(post({ jsonrpc: "2.0", id: 4, method: "tools/list" }), reg, stubCtx, async () => "u");
    const tools = ((await res.json()) as any).result.tools as any[];
    const get = tools.find((t) => t.name === "get_note");
    const del = tools.find((t) => t.name === "delete_task");
    expect(get.title).toBe("Read note");
    expect(get.annotations.readOnlyHint).toBe(true);
    expect(del.annotations.destructiveHint).toBe(true);
    expect(del.annotations.readOnlyHint).toBe(false);
  });
});
