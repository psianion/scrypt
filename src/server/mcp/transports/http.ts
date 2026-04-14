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
    // MCP SDK handshake — Claude Code / any MCP client sends these
    // before tools/list or tools/call. Keep stateless; we don't track
    // sessions since the HTTP transport is request-scoped.
    if (body.method === "initialize") {
      const clientProtocol =
        (body.params as { protocolVersion?: string } | undefined)
          ?.protocolVersion ?? "2024-11-05";
      return jsonRpcResponse(body.id, {
        result: {
          protocolVersion: clientProtocol,
          capabilities: { tools: {} },
          serverInfo: { name: "scrypt", version: "0.8.0" },
        },
      });
    }
    if (
      body.method === "notifications/initialized" ||
      body.method === "initialized"
    ) {
      // Notification — spec-wise has no id, but some clients still
      // POST it as a request. Acknowledge with an empty result.
      return jsonRpcResponse(body.id, { result: {} });
    }
    if (body.method === "ping") {
      return jsonRpcResponse(body.id, { result: {} });
    }
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
      // MCP spec: tools/call must return { content: [{type, text}], isError? }.
      // Tool-execution errors land in result.isError, NOT in the JSON-RPC
      // error envelope — that's reserved for protocol-level failures.
      try {
        const toolResult = await registry.call(
          name,
          args,
          ctx,
          correlationId,
        );
        return jsonRpcResponse(body.id, {
          result: {
            content: [
              { type: "text", text: JSON.stringify(toolResult) },
            ],
          },
        });
      } catch (toolErr) {
        if (toolErr instanceof McpError) {
          return jsonRpcResponse(body.id, {
            result: {
              isError: true,
              content: [
                {
                  type: "text",
                  text: JSON.stringify(toolErr.toJsonRpc(correlationId)),
                },
              ],
            },
          });
        }
        throw toolErr;
      }
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
