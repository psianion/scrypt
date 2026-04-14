// src/server/mcp/tools/index.ts
//
// Aggregator for all MCP tool definitions. Individual tool files land
// in Phase 6 (write) and Phase 7 (read). Until then this re-exports an
// empty register function so the transports can import it safely.
import type { ToolRegistry } from "../registry";

export function registerAllTools(_registry: ToolRegistry): void {
  // populated in Phase 6 and 7
}
