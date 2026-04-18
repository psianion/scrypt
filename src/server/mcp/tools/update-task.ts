// src/server/mcp/tools/update-task.ts
import { McpError, MCP_ERROR } from "../errors";
import type { ToolDef } from "../types";
import {
  TASK_TYPES,
  TASK_STATUSES,
  type Task,
  type TaskUpdate,
} from "../../indexer/tasks-repo";

const ALLOWED_FIELDS = new Set([
  "title",
  "type",
  "status",
  "due_date",
  "priority",
  "metadata",
]);

interface Input {
  task_id: number;
  fields: Record<string, unknown>;
  client_tag: string;
}

interface Output {
  task: Task;
}

export const updateTaskTool: ToolDef<Input, Output> = {
  name: "update_task",
  description:
    "Update an existing task. Allowed fields: title, type, status, due_date, priority, metadata.",
  inputSchema: {
    type: "object",
    properties: {
      task_id: { type: "number" },
      fields: { type: "object" },
      client_tag: { type: "string" },
    },
    required: ["task_id", "fields", "client_tag"],
  },
  async handler(ctx, input) {
    return ctx.idempotency.runCached(
      "update_task",
      input.client_tag,
      async () => {
        const keys = Object.keys(input.fields ?? {});
        if (keys.length === 0) {
          throw new McpError(
            MCP_ERROR.INVALID_PARAMS,
            "fields must contain at least one allowed update",
          );
        }
        for (const k of keys) {
          if (!ALLOWED_FIELDS.has(k)) {
            throw new McpError(
              MCP_ERROR.INVALID_PARAMS,
              `unknown field: ${k}. Allowed: ${[...ALLOWED_FIELDS].join(", ")}`,
            );
          }
        }

        const patch: TaskUpdate = {};
        if (input.fields.title !== undefined) {
          if (typeof input.fields.title !== "string") {
            throw new McpError(MCP_ERROR.INVALID_PARAMS, "title must be string");
          }
          patch.title = input.fields.title;
        }
        if (input.fields.type !== undefined) {
          if (!(TASK_TYPES as readonly string[]).includes(input.fields.type as string)) {
            throw new McpError(
              MCP_ERROR.INVALID_PARAMS,
              `invalid type: ${String(input.fields.type)}`,
            );
          }
          patch.type = input.fields.type as TaskUpdate["type"];
        }
        if (input.fields.status !== undefined) {
          if (
            !(TASK_STATUSES as readonly string[]).includes(
              input.fields.status as string,
            )
          ) {
            throw new McpError(
              MCP_ERROR.INVALID_PARAMS,
              `invalid status: ${String(input.fields.status)}`,
            );
          }
          patch.status = input.fields.status as TaskUpdate["status"];
        }
        if (input.fields.due_date !== undefined) {
          patch.due_date = input.fields.due_date as string | null;
        }
        if (input.fields.priority !== undefined) {
          if (typeof input.fields.priority !== "number") {
            throw new McpError(
              MCP_ERROR.INVALID_PARAMS,
              "priority must be number",
            );
          }
          patch.priority = input.fields.priority;
        }
        if (input.fields.metadata !== undefined) {
          patch.metadata =
            input.fields.metadata as Record<string, unknown> | null;
        }

        const updated = ctx.tasks.update(input.task_id, patch);
        if (!updated) {
          throw new McpError(
            MCP_ERROR.NOT_FOUND,
            `task not found: ${input.task_id}`,
          );
        }
        return { task: updated };
      },
    );
  },
};
