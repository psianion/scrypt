// tests/server/mcp/registry.test.ts
import { test, expect, describe } from "bun:test";
import { ToolRegistry } from "../../../src/server/mcp/registry";
import { MCP_ERROR } from "../../../src/server/mcp/errors";
import type { ToolContext } from "../../../src/server/mcp/types";

const stubCtx = {} as ToolContext;

describe("ToolRegistry", () => {
  test("registers and dispatches a tool", async () => {
    const reg = new ToolRegistry();
    reg.register<{ msg: string }, { echoed: string }>({
      name: "echo",
      description: "echoes the input",
      inputSchema: {
        type: "object",
        properties: { msg: { type: "string" } },
        required: ["msg"],
      },
      handler: async (_ctx, input) => ({ echoed: input.msg }),
    });

    const res = await reg.call("echo", { msg: "hi" }, stubCtx, "corr-1");
    expect(res).toEqual({ echoed: "hi" });
  });

  test("unknown tool throws NOT_FOUND", async () => {
    const reg = new ToolRegistry();
    let caught: unknown = null;
    try {
      await reg.call("missing", {}, stubCtx, "corr-1");
    } catch (e) {
      caught = e;
    }
    expect(caught).toMatchObject({ code: MCP_ERROR.NOT_FOUND });
  });

  test("missing required input throws INVALID_PARAMS", async () => {
    const reg = new ToolRegistry();
    reg.register({
      name: "needs_msg",
      description: "",
      inputSchema: {
        type: "object",
        properties: { msg: { type: "string" } },
        required: ["msg"],
      },
      handler: async () => ({}),
    });
    let caught: unknown = null;
    try {
      await reg.call("needs_msg", {}, stubCtx, "corr-1");
    } catch (e) {
      caught = e;
    }
    expect(caught).toMatchObject({ code: MCP_ERROR.INVALID_PARAMS });
  });

  test("wrong type throws INVALID_PARAMS", async () => {
    const reg = new ToolRegistry();
    reg.register({
      name: "needs_string",
      description: "",
      inputSchema: {
        type: "object",
        properties: { msg: { type: "string" } },
      },
      handler: async () => ({}),
    });
    let caught: unknown = null;
    try {
      await reg.call("needs_string", { msg: 42 }, stubCtx, "corr-1");
    } catch (e) {
      caught = e;
    }
    expect(caught).toMatchObject({ code: MCP_ERROR.INVALID_PARAMS });
  });

  test("listTools returns manifest entries", () => {
    const reg = new ToolRegistry();
    reg.register({
      name: "a",
      description: "one",
      inputSchema: { type: "object", properties: {} },
      handler: async () => ({}),
    });
    const list = reg.listTools();
    expect(list.length).toBe(1);
    expect(list[0].name).toBe("a");
  });
});
