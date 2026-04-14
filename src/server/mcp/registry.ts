// src/server/mcp/registry.ts
//
// A small Map-backed tool registry with JSON-schema-lite validation
// (enough to catch wrong types and missing required fields before a
// handler runs). Registered tools are dispatched by name.
import { McpError, MCP_ERROR } from "./errors";
import type {
  JsonSchema,
  ToolContext,
  ToolDef,
} from "./types";

function validateInput(
  schema: JsonSchema,
  input: unknown,
): string | null {
  if (schema.type !== "object") return null;
  const obj =
    input && typeof input === "object"
      ? (input as Record<string, unknown>)
      : null;
  const required = schema.required ?? [];
  for (const key of required) {
    if (!obj || !(key in obj)) return `missing required field: ${key}`;
  }
  if (obj && schema.properties) {
    for (const [key, spec] of Object.entries(schema.properties)) {
      if (!(key in obj)) continue;
      let v = obj[key];
      // Loose coerce: MCP clients (including Claude Code's tool_use
      // serialization) sometimes hand us stringified numbers / booleans.
      // Coerce in place so handlers always see the declared type.
      if (spec.type === "number" && typeof v === "string") {
        const n = Number(v);
        if (!Number.isNaN(n)) {
          obj[key] = n;
          v = n;
        }
      }
      if (spec.type === "boolean" && typeof v === "string") {
        if (v === "true") {
          obj[key] = true;
          v = true;
        } else if (v === "false") {
          obj[key] = false;
          v = false;
        }
      }
      if (spec.type === "string" && typeof v !== "string")
        return `field ${key}: expected string`;
      if (spec.type === "number" && typeof v !== "number")
        return `field ${key}: expected number`;
      if (spec.type === "boolean" && typeof v !== "boolean")
        return `field ${key}: expected boolean`;
      if (spec.type === "array" && !Array.isArray(v))
        return `field ${key}: expected array`;
      if (spec.enum && typeof v === "string" && !spec.enum.includes(v))
        return `field ${key}: not in ${JSON.stringify(spec.enum)}`;
    }
  }
  return null;
}

export interface ToolManifestEntry {
  name: string;
  description: string;
  inputSchema: JsonSchema;
}

export class ToolRegistry {
  private tools = new Map<string, ToolDef>();

  register<I, O>(def: ToolDef<I, O>): void {
    this.tools.set(def.name, def as ToolDef);
  }

  listTools(): ToolManifestEntry[] {
    return Array.from(this.tools.values()).map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    }));
  }

  async call(
    name: string,
    input: unknown,
    ctx: ToolContext,
    correlationId: string,
  ): Promise<unknown> {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new McpError(MCP_ERROR.NOT_FOUND, `unknown tool: ${name}`);
    }
    const err = validateInput(tool.inputSchema, input);
    if (err) {
      throw new McpError(MCP_ERROR.INVALID_PARAMS, err, { tool: name });
    }
    return tool.handler(ctx, input ?? {}, correlationId);
  }
}
