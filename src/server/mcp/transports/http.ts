// src/server/mcp/transports/http.ts
//
// POST /mcp JSON-RPC handler. Bearer-token authenticated. Shares the
// same tool registry and ToolContext as the stdio transport.
import { randomUUID } from "crypto";
import { ToolRegistry } from "../registry";
import type { ToolContext } from "../types";
import { McpError, MCP_ERROR } from "../errors";

export type AuthFn = (req: Request) => Promise<string | null>;

interface JsonRpcReq {
  jsonrpc: "2.0";
  id: number | string | null;
  method: string;
  params?: { name?: string; arguments?: Record<string, unknown> };
}

function jsonRpcResponse(
  id: number | string | null,
  body: Record<string, unknown>,
  status = 200,
): Response {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id, ...body }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export async function handleMcpHttp(
  req: Request,
  registry: ToolRegistry,
  baseCtx: ToolContext,
  auth: AuthFn,
): Promise<Response> {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  const userId = await auth(req);
  if (!userId) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }

  let body: JsonRpcReq;
  try {
    body = (await req.json()) as JsonRpcReq;
  } catch {
    return jsonRpcResponse(
      null,
      {
        error: { code: MCP_ERROR.INVALID_PARAMS, message: "bad json" },
      },
      400,
    );
  }

  const ctx: ToolContext = { ...baseCtx, userId };
  const correlationId = randomUUID();

  try {
    if (body.method === "tools/list") {
      return jsonRpcResponse(body.id, {
        result: { tools: registry.listTools() },
      });
    }
    if (body.method === "tools/call") {
      const name = body.params?.name;
      const args = body.params?.arguments ?? {};
      if (!name) {
        return jsonRpcResponse(body.id, {
          error: {
            code: MCP_ERROR.INVALID_PARAMS,
            message: "missing params.name",
          },
        });
      }
      const result = await registry.call(name, args, ctx, correlationId);
      return jsonRpcResponse(body.id, { result });
    }
    return jsonRpcResponse(body.id, {
      error: {
        code: MCP_ERROR.NOT_FOUND,
        message: `unknown method ${body.method}`,
      },
    });
  } catch (err) {
    if (err instanceof McpError) {
      return jsonRpcResponse(body.id, { error: err.toJsonRpc(correlationId) });
    }
    return jsonRpcResponse(
      body.id,
      {
        error: {
          code: MCP_ERROR.INTERNAL,
          message: String(err),
          data: { correlation_id: correlationId },
        },
      },
      500,
    );
  }
}
