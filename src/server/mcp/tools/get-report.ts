// src/server/mcp/tools/get-report.ts
import { generateReport } from "../../indexer/report";
import type { ToolDef } from "../types";

interface Input {
  scope?: { folder?: string; tag?: string };
}

interface Output {
  markdown: string;
}

export const getReportTool: ToolDef<Input, Output> = {
  name: "get_report",
  description:
    "Returns a markdown summary of the vault graph: hubs, communities, orphans, suggested questions.",
  inputSchema: {
    type: "object",
    properties: { scope: { type: "object" } },
  },
  async handler(ctx) {
    return { markdown: generateReport(ctx.db) };
  },
};
