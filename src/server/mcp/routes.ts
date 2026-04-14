// src/server/mcp/routes.ts
//
// Mounts the Wave 8 MCP streamable-http transport on the existing
// scrypt router. The tool registry and ToolContext are built once at
// boot and passed in.
import type { Router } from "../router";
import type { ToolRegistry } from "./registry";
import type { ToolContext } from "./types";
import { handleMcpHttp, type AuthFn } from "./transports/http";

export function mcpRoutes(
  router: Router,
  registry: ToolRegistry,
  ctx: ToolContext,
  auth: AuthFn,
): void {
  router.post("/mcp", (req) => handleMcpHttp(req, registry, ctx, auth));
}
