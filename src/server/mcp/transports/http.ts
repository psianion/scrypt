// src/server/mcp/transports/http.ts
//
// POST /mcp JSON-RPC handler. Bearer-token authenticated. Shares the
// same tool registry and ToolContext as the stdio transport.
import { randomUUID } from "crypto";
import { ToolRegistry } from "../registry";
import type { ToolContext } from "../types";
import { McpError, MCP_ERROR } from "../errors";
import type { PeerAddressProvider } from "../../auth";

export type AuthFn = (
  req: Request,
  server?: PeerAddressProvider,
) => Promise<string | null>;

// Returns the vault SCHEMA.md content for the MCP `instructions` field,
// or null when the vault has none. Read per-initialize so edits to the
// doc apply to the next session without a server restart.
export type InstructionsFn = () => string | null;

interface JsonRpcReq {
  jsonrpc: "2.0";
  id?: number | string | null;
  method: string;
  params?: { name?: string; arguments?: Record<string, unknown> };
}

export const SERVER_VERSION = "0.8.0";

/** Standard JSON-RPC code for an unknown method (the MCP_ERROR table holds
 *  scrypt's application codes). */
export const JSON_RPC_METHOD_NOT_FOUND = -32601;

/** Protocol revisions this transport implements, newest first. Per spec the
 *  server answers with the client's version when it supports it, otherwise
 *  with the latest it does — never with a version it has never heard of. */
export const SUPPORTED_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"] as const;

export function negotiateProtocolVersion(requested: string | undefined): string {
  if (requested && (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(requested)) return requested;
  return SUPPORTED_PROTOCOL_VERSIONS[0];
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
  server?: PeerAddressProvider,
  instructions?: InstructionsFn,
): Promise<Response> {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  const userId = await auth(req, server);
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
  // Every response below needs a request id; notifications (no id) are
  // answered before any of them.
  const reqId: number | string | null = body.id ?? null;

  try {
    // A JSON-RPC notification carries no id and MUST NOT get a response
    // body: the Streamable HTTP spec says 202 Accepted, empty. Answering
    // with `{"id":null,"result":{}}` (the old behaviour) is what MCP SDK
    // clients log as a protocol error on every session start.
    if (
      (body.id === undefined || body.id === null) &&
      typeof body.method === "string" &&
      body.method.startsWith("notifications/")
    ) {
      return new Response(null, { status: 202 });
    }

    // MCP SDK handshake — Claude Code / any MCP client sends these
    // before tools/list or tools/call. Keep stateless; we don't track
    // sessions since the HTTP transport is request-scoped.
    if (body.method === "initialize") {
      const requested =
        (body.params as { protocolVersion?: string } | undefined)
          ?.protocolVersion;
      const schemaDoc = instructions?.() ?? null;
      return jsonRpcResponse(reqId, {
        result: {
          protocolVersion: negotiateProtocolVersion(requested),
          capabilities: { tools: {} },
          serverInfo: { name: "scrypt", version: SERVER_VERSION },
          ...(schemaDoc !== null ? { instructions: schemaDoc } : {}),
        },
      });
    }
    if (body.method === "initialized") {
      // Legacy clients that POST the initialized notification as a request.
      return jsonRpcResponse(reqId, { result: {} });
    }
    if (body.method === "ping") {
      return jsonRpcResponse(reqId, { result: {} });
    }
    if (body.method === "tools/list") {
      return jsonRpcResponse(reqId, {
        result: { tools: registry.listTools() },
      });
    }
    if (body.method === "tools/call") {
      const name = body.params?.name;
      const args = body.params?.arguments ?? {};
      if (!name) {
        return jsonRpcResponse(reqId, {
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
        return jsonRpcResponse(reqId, {
          result: {
            content: [
              { type: "text", text: JSON.stringify(toolResult) },
            ],
          },
        });
      } catch (toolErr) {
        if (toolErr instanceof McpError) {
          return jsonRpcResponse(reqId, {
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
    return jsonRpcResponse(reqId, {
      error: {
        code: JSON_RPC_METHOD_NOT_FOUND,
        message: `unknown method ${body.method}`,
      },
    });
  } catch (err) {
    if (err instanceof McpError) {
      return jsonRpcResponse(reqId, { error: err.toJsonRpc(correlationId) });
    }
    return jsonRpcResponse(
      reqId,
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
