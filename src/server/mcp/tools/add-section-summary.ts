// src/server/mcp/tools/add-section-summary.ts
import { McpError, MCP_ERROR } from "../errors";
import type { ToolDef } from "../types";

interface Input {
  note_path: string;
  heading_id: string;
  summary: string;
  client_tag: string;
}

interface Output {
  section_id: string;
}

export const addSectionSummaryTool: ToolDef<Input, Output> = {
  name: "add_section_summary",
  description: "Sets a one-line summary on an existing note section.",
  inputSchema: {
    type: "object",
    properties: {
      note_path: { type: "string" },
      heading_id: { type: "string" },
      summary: { type: "string" },
      client_tag: { type: "string" },
    },
    required: ["note_path", "heading_id", "summary", "client_tag"],
  },
  async handler(ctx, input) {
    return ctx.idempotency.runCached(
      "add_section_summary",
      input.client_tag,
      async () => {
        const changed = ctx.sections.setSummary(
          input.heading_id,
          input.summary,
        );
        if (changed === 0) {
          throw new McpError(
            MCP_ERROR.NOT_FOUND,
            `section not found: ${input.heading_id}`,
          );
        }
        return { section_id: input.heading_id };
      },
    );
  },
};
