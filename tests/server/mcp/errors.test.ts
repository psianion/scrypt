// tests/server/mcp/errors.test.ts
import { test, expect } from "bun:test";
import { McpError, MCP_ERROR } from "../../../src/server/mcp/errors";

test("McpError serializes to JSON-RPC error object", () => {
  const e = new McpError(MCP_ERROR.NOT_FOUND, "note missing", {
    path: "x.md",
  });
  const obj = e.toJsonRpc("corr-123");
  expect(obj.code).toBe(MCP_ERROR.NOT_FOUND);
  expect(obj.message).toBe("note missing");
  expect(obj.data.path).toBe("x.md");
  expect(obj.data.correlation_id).toBe("corr-123");
});

test("all spec'd codes exist", () => {
  expect(MCP_ERROR.INVALID_PARAMS).toBe(-32602);
  expect(MCP_ERROR.NOT_FOUND).toBe(-32000);
  expect(MCP_ERROR.CONFLICT).toBe(-32001);
  expect(MCP_ERROR.IDEMPOTENCY_MISMATCH).toBe(-32002);
  expect(MCP_ERROR.AUTH_FAILED).toBe(-32003);
  expect(MCP_ERROR.VAULT_LOCKED).toBe(-32004);
  expect(MCP_ERROR.EMBED_DISABLED).toBe(-32005);
  expect(MCP_ERROR.EMBED_UNAVAILABLE).toBe(-32006);
  expect(MCP_ERROR.INTERNAL).toBe(-32099);
});

test("McpError extends Error (instanceof + stack)", () => {
  const e = new McpError(MCP_ERROR.INTERNAL, "boom");
  expect(e).toBeInstanceOf(Error);
  expect(typeof e.stack).toBe("string");
});
