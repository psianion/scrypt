import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import type { Note } from "../../shared/types";
import { buildTree, type FolderNode } from "./FolderTree.helpers";

const STORAGE_KEY = "scrypt.sidebar.expanded";

function loadExpanded(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw));
  } catch {
    return new Set();
  }
}

function saveExpanded(expanded: Set<string>): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...expanded]));
}

export function FolderTree() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(() => loadExpanded());
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    fetch("/api/notes")
      .then((r) => r.json())
      .then((data) => setNotes(Array.isArray(data) ? data : []))
      .catch(() => setNotes([]));
  }, []);

  useEffect(() => {
    const match = location.pathname.match(/^\/note\/(.+)$/);
    if (!match) return;
    const path = match[1];
    const parts = path.split("/").slice(0, -1);
    if (parts.length === 0) return;
    setExpanded((prev) => {
      const next = new Set(prev);
      for (let i = 0; i < parts.length; i++) {
        next.add(parts.slice(0, i + 1).join("/"));
      }
      saveExpanded(next);
      return next;
    });
  }, [location.pathname]);

  const root = useMemo(() => buildTree(notes), [notes]);

  function toggle(path: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      saveExpanded(next);
      return next;
    });
  }

  if (root.children.size === 0 && notes.length === 0) {
    return (
      <div className="px-3 py-4 text-xs text-[var(--text-muted)]">
        Drop a markdown file here or press <kbd>+</kbd> to create one.
      </div>
    );
  }

  return (
    <div data-testid="folder-tree" className="text-sm">
      {[...root.children.values()].map((child) => (
        <FolderRow
          key={child.path}
          node={child}
          depth={0}
          expanded={expanded}
          onToggle={toggle}
          onNoteClick={(p) => navigate(`/note/${p}`)}
          currentPath={location.pathname}
        />
      ))}
    </div>
  );
}

interface FolderRowProps {
  node: FolderNode;
  depth: number;
  expanded: Set<string>;
  onToggle: (path: string) => void;
  onNoteClick: (path: string) => void;
  currentPath: string;
}

function FolderRow({
  node,
  depth,
  expanded,
  onToggle,
  onNoteClick,
  currentPath,
}: FolderRowProps) {
  const isOpen = expanded.has(node.path);
  const indent = { paddingLeft: `${depth * 12 + 8}px` };
  return (
    <div>
      <button
        onClick={() => onToggle(node.path)}
        className="w-full text-left text-[var(--text-secondary)] hover:text-[var(--text-primary)] flex items-center gap-1"
        style={indent}
      >
        <span className="inline-block w-3 text-[var(--text-muted)]">
          {isOpen ? "▾" : "▸"}
        </span>
        {node.label}
      </button>
      {isOpen && (
        <>
          {[...node.children.values()].map((child) => (
            <FolderRow
              key={child.path}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              onToggle={onToggle}
              onNoteClick={onNoteClick}
              currentPath={currentPath}
            />
          ))}
          {node.notes.map((n) => {
            const isActive = currentPath === `/note/${n.path}`;
            return (
              <button
                key={n.path}
                onClick={() => onNoteClick(n.path)}
                title={n.path}
                style={{ paddingLeft: `${(depth + 1) * 12 + 12}px` }}
                className={`block w-full text-left truncate ${
                  isActive
                    ? "text-[var(--text-primary)] bg-[var(--bg-tertiary)]"
                    : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                }`}
              >
                {n.title ?? n.path}
              </button>
            );
          })}
        </>
      )}
    </div>
  );
}
