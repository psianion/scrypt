import { useMemo, useState } from "react";
import { DOC_TYPES } from "../../server/vocab/doc-types";
import {
  buildProjectTree,
  type FolderTreeNote,
} from "./FolderTree.helpers";

const STORAGE_KEY = "scrypt.sidebar.expanded";

function loadExpanded(): Set<string> {
  try {
    const raw =
      typeof localStorage !== "undefined"
        ? localStorage.getItem(STORAGE_KEY)
        : null;
    if (!raw) return new Set();
    return new Set(JSON.parse(raw));
  } catch {
    return new Set();
  }
}

function saveExpanded(expanded: Set<string>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...expanded]));
  } catch {
    /* storage disabled — ignore */
  }
}

export interface FolderTreeProps {
  notes: FolderTreeNote[];
  thread?: { project: string; thread: string } | null;
  showAllTypes?: boolean;
  currentPath?: string;
  onNoteClick?: (path: string) => void;
}

export function FolderTree({
  notes,
  thread = null,
  showAllTypes = false,
  currentPath,
  onNoteClick,
}: FolderTreeProps) {
  const [expanded, setExpanded] = useState<Set<string>>(() => loadExpanded());

  const groups = useMemo(
    () => buildProjectTree(notes, { thread }),
    [notes, thread],
  );

  if (groups.length === 0) {
    return (
      <div className="px-3 py-4 text-xs text-[var(--text-muted)]">
        Drop a markdown file here or press <kbd>+</kbd> to create one.
      </div>
    );
  }

  function toggle(key: string): void {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      saveExpanded(next);
      return next;
    });
  }

  return (
    <div data-testid="folder-tree" className="text-sm">
      {groups.map((g) => {
        const isInbox = g.project === "_inbox";
        const docTypeEntries = showAllTypes
          ? DOC_TYPES.map((dt) => [dt, g.docTypes.get(dt) ?? []] as const)
          : [...g.docTypes.entries()];

        return (
          <div key={g.project} data-project={g.project} className="mb-2">
            <div
              className={`flex items-center gap-1 px-1 py-0.5 ${
                isInbox
                  ? "font-semibold text-[var(--text-primary)]"
                  : "text-[var(--text-secondary)]"
              }`}
            >
              <span className="flex-1 truncate" title={g.project}>
                {g.project}
              </span>
              <span className="text-[10px] text-[var(--text-muted)] tabular-nums">
                {g.total}
              </span>
            </div>

            {docTypeEntries.map(([dt, docNotes]) => {
              const key = `${g.project}/${dt}`;
              const open = expanded.has(key);
              return (
                <div key={dt} data-doc-type={dt}>
                  <button
                    type="button"
                    onClick={() => toggle(key)}
                    className="w-full text-left flex items-center gap-1 pl-3 pr-1 py-0.5 text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                  >
                    <span className="inline-block w-3 text-[var(--text-muted)]">
                      {open ? "▾" : "▸"}
                    </span>
                    <span className="flex-1 truncate">{dt}</span>
                    <span className="text-[10px] text-[var(--text-muted)] tabular-nums">
                      {docNotes.length}
                    </span>
                  </button>
                  {open &&
                    docNotes.map((n) => {
                      const isActive = currentPath === `/note/${n.path}`;
                      const label =
                        n.title && n.title.length > 0
                          ? n.title
                          : (n.path.split("/").pop() ?? n.path);
                      return (
                        <button
                          key={n.path}
                          type="button"
                          onClick={() => onNoteClick?.(n.path)}
                          title={`${n.title ?? ""}\n${n.path}`.trim()}
                          className={`block w-full text-left truncate pl-7 pr-2 py-0.5 ${
                            isActive
                              ? "text-[var(--text-primary)] bg-[var(--bg-tertiary)]"
                              : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                          }`}
                        >
                          {label}
                        </button>
                      );
                    })}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
