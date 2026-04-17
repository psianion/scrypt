// src/server/mcp/tools/get-task.ts
import type { ToolDef } from "../types";
import type { Task } from "../../indexer/tasks-repo";

interface Input {
  task_id: number;
}

interface Output {
  task: Task | null;
}

export const getTaskTool: ToolDef<Input, Output> = {
  name: "get_task",
  description: "Fetch a task by id; returns null if not found.",
  inputSchema: {
    type: "object",
    properties: { task_id: { type: "number" } },
    required: ["task_id"],
  },
  async handler(ctx, input) {
    return { task: ctx.tasks.get(input.task_id) };
  },
};
