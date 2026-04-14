// src/server/mcp/tools/index.ts
//
// Aggregator for all MCP tool definitions.
import type { ToolRegistry } from "../registry";
import { createNoteTool } from "./create-note";

export function registerAllTools(registry: ToolRegistry): void {
  registry.register(createNoteTool);
}
