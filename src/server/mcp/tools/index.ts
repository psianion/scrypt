// src/server/mcp/tools/index.ts
import type { ToolRegistry } from "../registry";
import { createNoteTool } from "./create-note";
import { updateNoteMetadataTool } from "./update-note-metadata";
import { addSectionSummaryTool } from "./add-section-summary";
import { addEdgeTool } from "./add-edge";
import { removeEdgeTool } from "./remove-edge";
import { getNoteTool } from "./get-note";
import { searchNotesTool } from "./search-notes";
import { semanticSearchTool } from "./semantic-search";
import { findSimilarTool } from "./find-similar";
import { walkGraphTool } from "./walk-graph";
import { clusterGraphTool } from "./cluster-graph";
import { getReportTool } from "./get-report";

export function registerAllTools(registry: ToolRegistry): void {
  registry.register(createNoteTool);
  registry.register(updateNoteMetadataTool);
  registry.register(addSectionSummaryTool);
  registry.register(addEdgeTool);
  registry.register(removeEdgeTool);
  registry.register(getNoteTool);
  registry.register(searchNotesTool);
  registry.register(semanticSearchTool);
  registry.register(findSimilarTool);
  registry.register(walkGraphTool);
  registry.register(clusterGraphTool);
  registry.register(getReportTool);
}
