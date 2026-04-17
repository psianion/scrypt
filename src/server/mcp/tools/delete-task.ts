// src/server/mcp/tools/delete-task.ts
import type { ToolDef } from "../types";

interface Input {
  task_id: number;
  client_tag: string;
}

interface Output {
  deleted: boolean;
}

export const deleteTaskTool: ToolDef<Input, Output> = {
  name: "delete_task",
  description: "Delete a task by id. Returns {deleted: false} if not present.",
  inputSchema: {
    type: "object",
    properties: {
      task_id: { type: "number" },
      client_tag: { type: "string" },
    },
    required: ["task_id", "client_tag"],
  },
  async handler(ctx, input) {
    return ctx.idempotency.runCached(
      "delete_task",
      input.client_tag,
      async () => {
        const deleted = ctx.tasks.delete(input.task_id);
        return { deleted };
      },
    );
  },
};
