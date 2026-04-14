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
