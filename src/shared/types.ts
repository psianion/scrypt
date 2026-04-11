// src/shared/types.ts

export interface NoteMeta {
  path: string;
  title: string;
  tags: string[];
  created: string;
  modified: string;
  aliases: string[];
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

export interface GraphNode {
  id: number;
  path: string;
  title: string;
  tags: string[];
  connections: number;
}

export interface GraphEdge {
  source: number;
  target: number;
  type: "link" | "tag" | "embed";
}

export interface Task {
  id: number;
  noteId: number;
  notePath: string;
  text: string;
  done: boolean;
  dueDate: string | null;
  priority: number;
  board: string;
  line: number;
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
