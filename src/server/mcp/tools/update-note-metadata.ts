// src/server/mcp/tools/update-note-metadata.ts
import { McpError, MCP_ERROR } from "../errors";
import type { ToolDef } from "../types";
import {
  DOC_TYPES,
  type DocType,
  type NoteMetadataPatch,
} from "../../indexer/metadata-repo";
import { refreshNoteFts } from "../../indexer/fts-refresh";
import { validateIngestBlock } from "../../ingest/ingest-block";

const SUMMARY_MAX = 1000;

interface Input {
  path: string;
  description?: string;
  entities?: { name: string; kind: string }[];
  themes?: string[];
  doc_type?: DocType;
  summary?: string;
  /** ingest-v3: move the note to a different project (rename `notes.project`). */
  project?: string;
  /** ingest-v3: stamp/clear the thread group this note belongs to. */
  thread?: string | null;
  /** ingest-v3: provenance block (frontmatter mirror); validated but not persisted to DB here. */
  ingest?: unknown;
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
      thread: {
        type: "string",
        description:
          "Thread group slug. Pass null to detach the note from its thread.",
      },
      project: { type: "string" },
      ingest: { type: "object" },
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
        // ingest-v3: validate provenance block shape. We don't persist it to
        // the DB here (frontmatter is the source of truth for ingest metadata);
        // this is a shape gate so callers get early feedback.
        if (input.ingest !== undefined) {
          const v = validateIngestBlock(input.ingest);
          if (!v.ok) {
            throw new McpError(
              MCP_ERROR.INVALID_PARAMS,
              `ingest block invalid: ${v.reason}`,
            );
          }
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

        // ingest-v3: denormalize project / thread into the notes row. We use
        // COALESCE on project so callers that pass only thread don't clobber
        // project; thread flips to NULL explicitly when the caller passes
        // `thread: null` so notes can be detached from a thread.
        if (input.project !== undefined) {
          ctx.db.run(`UPDATE notes SET project = ? WHERE path = ?`, [
            input.project,
            input.path,
          ]);
          updated.push("project");
        }
        if (input.thread !== undefined) {
          ctx.db.run(`UPDATE notes SET thread = ? WHERE path = ?`, [
            input.thread,
            input.path,
          ]);
          updated.push("thread");
        }
        if (input.ingest !== undefined) {
          updated.push("ingest");
        }

        refreshNoteFts(ctx.db, input.path);
        ctx.scheduleGraphRebuild();
        return { note_path: input.path, updated_fields: updated };
      },
    );
  },
};
