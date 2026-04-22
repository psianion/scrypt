// src/server/mcp/tools/update-note-metadata.ts
import { McpError, MCP_ERROR } from "../errors";
import type { ToolDef } from "../types";
import {
  DOC_TYPES,
  type DocType,
  type NoteMetadataPatch,
} from "../../indexer/metadata-repo";

const SUMMARY_MAX = 1000;

interface Input {
  path: string;
  description?: string;
  entities?: { name: string; kind: string }[];
  themes?: string[];
  doc_type?: DocType;
  summary?: string;
  client_tag: string;
}

interface Output {
  note_path: string;
  updated_fields: string[];
}

export const updateNoteMetadataTool: ToolDef<Input, Output> = {
  name: "update_note_metadata",
  description:
    "Upserts semantic metadata (description, entities, themes, doc_type, summary) for a note.",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string" },
      description: { type: "string" },
      entities: { type: "array" },
      themes: { type: "array" },
      doc_type: { type: "string", enum: [...DOC_TYPES] },
      summary: { type: "string" },
      client_tag: { type: "string" },
    },
    required: ["path", "client_tag"],
  },
  async handler(ctx, input) {
    return ctx.idempotency.runCached(
      "update_note_metadata",
      input.client_tag,
      async () => {
        if (
          input.doc_type !== undefined &&
          !DOC_TYPES.includes(input.doc_type as DocType)
        ) {
          throw new McpError(
            MCP_ERROR.INVALID_PARAMS,
            `invalid doc_type: ${input.doc_type}. Allowed: ${DOC_TYPES.join(", ")}`,
          );
        }
        if (input.summary !== undefined && input.summary.length > SUMMARY_MAX) {
          throw new McpError(
            MCP_ERROR.INVALID_PARAMS,
            `summary exceeds ${SUMMARY_MAX} chars (got ${input.summary.length})`,
          );
        }

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
        if (input.entities !== undefined) {
          patch.entities = input.entities;
          updated.push("entities");
        }
        if (input.themes !== undefined) {
          patch.themes = input.themes;
          updated.push("themes");
        }
        if (input.doc_type !== undefined) {
          patch.doc_type = input.doc_type;
          updated.push("doc_type");
        }
        if (input.summary !== undefined) {
          patch.summary = input.summary;
          updated.push("summary");
        }
        ctx.metadata.upsert(input.path, patch);
        ctx.scheduleGraphRebuild();
        return { note_path: input.path, updated_fields: updated };
      },
    );
  },
};
