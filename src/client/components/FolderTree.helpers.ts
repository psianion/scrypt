import type { Note } from "../../shared/types";

export interface FolderNode {
  label: string;
  path: string;
  children: Map<string, FolderNode>;
  notes: Note[];
}

const RESERVED_TOP_LEVEL = new Set([
  "journal",
  "data",
  "assets",
  ".scrypt",
  "dist",
]);

export function buildTree(notes: Note[]): FolderNode {
  const root: FolderNode = {
    label: "",
    path: "",
    children: new Map(),
    notes: [],
  };
  for (const note of notes) {
    const parts = note.path.split("/");
    if (parts.length === 0) continue;
    if (RESERVED_TOP_LEVEL.has(parts[0])) continue;
    let cursor = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (!cursor.children.has(part)) {
        cursor.children.set(part, {
          label: part,
          path: parts.slice(0, i + 1).join("/"),
          children: new Map(),
          notes: [],
        });
      }
      cursor = cursor.children.get(part)!;
    }
    cursor.notes.push(note);
  }
  sortTree(root);
  return root;
}

function sortTree(node: FolderNode): void {
  const sortedChildren = new Map(
    [...node.children.entries()].sort((a, b) => a[0].localeCompare(b[0])),
  );
  node.children = sortedChildren;
  for (const child of node.children.values()) sortTree(child);
  node.notes.sort((a, b) => (a.title ?? "").localeCompare(b.title ?? ""));
}
