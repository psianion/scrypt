// src/server/mcp/tools/update-note-metadata.ts
import { McpError, MCP_ERROR } from "../errors";
import type { ToolDef } from "../types";
import type { NoteMetadataPatch } from "../../indexer/metadata-repo";

interface Input {
  path: string;
  description?: string;
  auto_tags?: string[];
  entities?: { name: string; kind: string }[];
  themes?: string[];
  client_tag: string;
}

interface Output {
  note_path: string;
  updated_fields: string[];
}

export const updateNoteMetadataTool: ToolDef<Input, Output> = {
  name: "update_note_metadata",
  description:
    "Upserts semantic metadata (description, auto_tags, entities, themes) for a note.",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string" },
      description: { type: "string" },
      auto_tags: { type: "array" },
      entities: { type: "array" },
      themes: { type: "array" },
      client_tag: { type: "string" },
    },
    required: ["path", "client_tag"],
  },
  async handler(ctx, input) {
    return ctx.idempotency.runCached(
      "update_note_metadata",
      input.client_tag,
      async () => {
        const exists =
          ctx.db
            .query<{ n: number }, [string]>(
              `SELECT COUNT(*) AS n FROM graph_nodes WHERE id = ?`,
            )
            .get(input.path)?.n ?? 0;
        if (!exists) {
          throw new McpError(
            MCP_ERROR.NOT_FOUND,
            `note not found: ${input.path}`,
          );
        }

        const updated: string[] = [];
        const patch: NoteMetadataPatch = {};
        if (input.description !== undefined) {
          patch.description = input.description;
          updated.push("description");
        }
        if (input.auto_tags !== undefined) {
          patch.auto_tags = input.auto_tags;
          updated.push("auto_tags");
        }
        if (input.entities !== undefined) {
          patch.entities = input.entities;
          updated.push("entities");
        }
        if (input.themes !== undefined) {
          patch.themes = input.themes;
          updated.push("themes");
        }
        ctx.metadata.upsert(input.path, patch);
        return { note_path: input.path, updated_fields: updated };
      },
    );
  },
};
