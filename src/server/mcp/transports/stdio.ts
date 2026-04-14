// src/server/mcp/transports/stdio.ts
//
// Wires the MCP SDK Server to stdin/stdout. One process per launch;
// the process exits when the parent closes stdin.
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { randomUUID } from "crypto";
import type { ToolRegistry } from "../registry";
import type { ToolContext } from "../types";
import { McpError } from "../errors";

export async function runStdio(
  registry: ToolRegistry,
  ctx: ToolContext,
): Promise<void> {
  const server = new Server(
    { name: "scrypt", version: "0.8.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: registry.listTools(),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const correlationId = randomUUID();
    try {
      const result = await registry.call(
        req.params.name,
        req.params.arguments ?? {},
        ctx,
        correlationId,
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
      };
    } catch (err) {
      if (err instanceof McpError) {
        return {
          isError: true,
          content: [
            { type: "text", text: JSON.stringify(err.toJsonRpc(correlationId)) },
          ],
        };
      }
      throw err;
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
