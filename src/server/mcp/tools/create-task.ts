// src/server/mcp/tools/create-task.ts
import { McpError, MCP_ERROR } from "../errors";
import type { ToolDef } from "../types";
import {
  TASK_TYPES,
  TASK_STATUSES,
  type TaskType,
  type TaskStatus,
} from "../../indexer/tasks-repo";

interface Input {
  note_path?: string | null;
  title: string;
  type: TaskType;
  status?: TaskStatus;
  due_date?: string;
  priority?: number;
  metadata?: Record<string, unknown>;
  client_tag: string;
}

interface Output {
  task_id: number;
  created_at: number;
}

export const createTaskTool: ToolDef<Input, Output> = {
  name: "create_task",
  description:
    "Creates a task. Type must be one of BRAINSTORM, PLAN, BUILD, RESEARCH, REVIEW, CUSTOM. note_path is optional — omit for standalone tasks not tied to a note.",
  inputSchema: {
    type: "object",
    properties: {
      note_path: { type: "string" },
      title: { type: "string" },
      type: { type: "string", enum: [...TASK_TYPES] },
      status: { type: "string", enum: [...TASK_STATUSES] },
      due_date: { type: "string" },
      priority: { type: "number" },
      metadata: { type: "object" },
      client_tag: { type: "string" },
    },
    required: ["title", "type", "client_tag"],
  },
  async handler(ctx, input) {
    return ctx.idempotency.runCached(
      "create_task",
      input.client_tag,
      async () => {
        if (!(TASK_TYPES as readonly string[]).includes(input.type)) {
          throw new McpError(
            MCP_ERROR.INVALID_PARAMS,
            `invalid type: ${input.type}. Allowed: ${TASK_TYPES.join(", ")}`,
          );
        }
        if (
          input.status !== undefined &&
          !(TASK_STATUSES as readonly string[]).includes(input.status)
        ) {
          throw new McpError(
            MCP_ERROR.INVALID_PARAMS,
            `invalid status: ${input.status}. Allowed: ${TASK_STATUSES.join(", ")}`,
          );
        }
        if (!input.title || input.title.trim().length === 0) {
          throw new McpError(MCP_ERROR.INVALID_PARAMS, "title is required");
        }
        const task = ctx.tasks.create({
          note_path: input.note_path,
          title: input.title,
          type: input.type,
          status: input.status,
          due_date: input.due_date,
          priority: input.priority,
          metadata: input.metadata,
          client_tag: input.client_tag,
        });
        return { task_id: task.id, created_at: task.created_at };
      },
    );
  },
};
