// src/server/mcp/errors.ts
//
// JSON-RPC 2.0 error codes used by the Wave 8 MCP layer. Matches
// docs/superpowers/specs/2026-04-14-scrypt-mcp-l5-design.md §7.
export const MCP_ERROR = {
  INVALID_PARAMS: -32602,
  NOT_FOUND: -32000,
  CONFLICT: -32001,
  IDEMPOTENCY_MISMATCH: -32002,
  AUTH_FAILED: -32003,
  VAULT_LOCKED: -32004,
  EMBED_DISABLED: -32005,
  EMBED_UNAVAILABLE: -32006,
  INTERNAL: -32099,
} as const;

export type McpErrorCode = (typeof MCP_ERROR)[keyof typeof MCP_ERROR];

export class McpError extends Error {
  constructor(
    public readonly code: McpErrorCode,
    message: string,
    public readonly data: Record<string, unknown> = {},
  ) {
    super(message);
  }

  toJsonRpc(correlationId: string): {
    code: McpErrorCode;
    message: string;
    data: Record<string, unknown> & { correlation_id: string };
  } {
    return {
      code: this.code,
      message: this.message,
      data: { ...this.data, correlation_id: correlationId },
    };
  }
}
