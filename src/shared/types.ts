// src/shared/types.ts

export interface Tag {
  namespace: string | null;
  value: string;
  raw: string;
}

export const RESERVED_NAMESPACES = new Set([
  "type",
  "project",
  "stage",
  "status",
  "owner",
]);

export interface NoteMeta {
  path: string;
  title: string;
  tags: string[];
  created: string;
  modified: string;
  aliases: string[];
  domain: string | null;
  subdomain: string | null;
  identifierTags: Tag[];
  topicTags: string[];
}

export interface Note extends NoteMeta {
  content: string;
  frontmatter: Record<string, unknown>;
}

export interface Backlink {
  sourcePath: string;
  sourceTitle: string;
  context: string;
}

// Legacy indexer-table shapes used by GET /api/graph/*path (the local
// subgraph walk). The canonical full-graph types with 4 edge weights live
// in `./graph-types.ts` and are used by GET /api/graph.
export interface LocalGraphNode {
  id: string;
  path: string;
  title: string;
  tags: string[];
  connections: number;
}

export interface LocalGraphEdge {
  source: string;
  target: string;
  type: string;
}

export type TaskType =
  | "BRAINSTORM"
  | "PLAN"
  | "BUILD"
  | "RESEARCH"
  | "REVIEW"
  | "CUSTOM";

export type TaskStatus = "open" | "in_progress" | "closed";

export interface Task {
  id: number;
  note_path: string | null;
  title: string;
  type: TaskType;
  status: TaskStatus;
  due_date: string | null;
  priority: number;
  metadata: Record<string, unknown> | null;
  client_tag: string | null;
  created_at: number;
  updated_at: number;
}

export interface SearchResult {
  path: string;
  title: string;
  snippet: string;
}

export interface FileEvent {
  type: "create" | "modify" | "delete";
  path: string;
}

export interface WsMessage {
  type: "noteChanged" | "noteCreated" | "noteDeleted" | "reindexed";
  path?: string;
}

export interface WikiLink {
  target: string;
  display?: string;
}

export interface ParsedTask {
  text: string;
  done: boolean;
  line: number;
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  entry: string;
  hooks?: string[];
  commands?: { id: string; name: string }[];
}

interface SkillDef {
  name: string;
  description: string;
  input: Record<string, string>;
  output: string;
  body: string;
}

interface CsvSchema {
  headers: string[];
  types: string[];
  rowCount: number;
}
