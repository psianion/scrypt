// src/server/mcp/tools/index.ts
import type { ToolRegistry } from "../registry";
import { createNoteTool } from "./create-note";
import { updateNoteMetadataTool } from "./update-note-metadata";
import { addSectionSummaryTool } from "./add-section-summary";
import { addEdgeTool } from "./add-edge";
import { removeEdgeTool } from "./remove-edge";

export function registerAllTools(registry: ToolRegistry): void {
  registry.register(createNoteTool);
  registry.register(updateNoteMetadataTool);
  registry.register(addSectionSummaryTool);
  registry.register(addEdgeTool);
  registry.register(removeEdgeTool);
}
