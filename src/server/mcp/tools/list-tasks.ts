// src/server/mcp/tools/list-tasks.ts
import { McpError, MCP_ERROR } from "../errors";
import type { ToolDef } from "../types";
import {
  TASK_TYPES,
  TASK_STATUSES,
  type Task,
  type TaskType,
  type TaskStatus,
} from "../../indexer/tasks-repo";

interface Input {
  note_path?: string;
  type?: TaskType;
  status?: TaskStatus;
  limit?: number;
  offset?: number;
}

interface Output {
  tasks: Task[];
  total: number;
}

export const listTasksTool: ToolDef<Input, Output> = {
  name: "list_tasks",
  description:
    "List tasks with optional filters. Ordered by priority desc, due_date asc.",
  inputSchema: {
    type: "object",
    properties: {
      note_path: { type: "string" },
      type: { type: "string", enum: [...TASK_TYPES] },
      status: { type: "string", enum: [...TASK_STATUSES] },
      limit: { type: "number" },
      offset: { type: "number" },
    },
    required: [],
  },
  async handler(ctx, input) {
    if (
      input.type !== undefined &&
      !(TASK_TYPES as readonly string[]).includes(input.type)
    ) {
      throw new McpError(MCP_ERROR.INVALID_PARAMS, `invalid type: ${input.type}`);
    }
    if (
      input.status !== undefined &&
      !(TASK_STATUSES as readonly string[]).includes(input.status)
    ) {
      throw new McpError(
        MCP_ERROR.INVALID_PARAMS,
        `invalid status: ${input.status}`,
      );
    }
    return ctx.tasks.list({
      note_path: input.note_path,
      type: input.type,
      status: input.status,
      limit: input.limit,
      offset: input.offset,
    });
  },
};
