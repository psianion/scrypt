// src/server/mcp/annotations.ts
//
// MCP tool annotations (spec 2025-03-26+). Clients use these to decide how
// much ceremony a call needs: Claude Code can auto-allow read-only tools and
// warn before destructive ones. Hints only — the server still enforces.
export interface ToolAnnotations {
  title: string;
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
}

const ro = (title: string): ToolAnnotations => ({ title, readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
const write = (title: string, idempotent = true): ToolAnnotations => ({ title, readOnlyHint: false, destructiveHint: false, idempotentHint: idempotent, openWorldHint: false });
const destructive = (title: string): ToolAnnotations => ({ title, readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false });

export const TOOL_ANNOTATIONS: Record<string, ToolAnnotations> = {
  // Read
  get_note: ro("Read note"),
  search_notes: ro("Search notes (keyword)"),
  semantic_search: ro("Search notes (semantic)"),
  find_similar: ro("Find similar notes"),
  walk_graph: ro("Walk note graph"),
  cluster_graph: ro("Cluster note graph"),
  get_report: ro("Get report"),
  get_task: ro("Read task"),
  list_tasks: ro("List tasks"),
  lint_vault: ro("Lint vault"),
  // Write (additive or idempotent)
  create_note: write("Create note"),
  update_note_metadata: write("Update note metadata"),
  add_section_summary: write("Add section summary"),
  add_edge: write("Add graph edge"),
  create_task: write("Create task", false),
  update_task: write("Update task"),
  batch_ingest: write("Batch ingest", false),
  rescan_similarity: write("Rescan similarity"),
  // Destructive
  remove_edge: destructive("Remove graph edge"),
  delete_task: destructive("Delete task"),
};
