import { useNavigate, useLocation } from "react-router";
import { useEffect, useMemo, useState } from "react";
import { useStore } from "../store";
import { api } from "../api";
import { FolderTree } from "./FolderTree";
import { ThreadChips, deriveThreadsFromNotes } from "./ThreadChips";

const NAV_ITEMS = [
  { label: "Notes", path: "/notes" },
  { label: "Journal", path: "/journal" },
  { label: "Tasks", path: "/tasks" },
  { label: "Graph", path: "/graph" },
  { label: "Data", path: "/data" },
  { label: "Tags", path: "/tags" },
];

interface SidebarProps {
  onNewNote?: () => void;
}

export function Sidebar({ onNewNote }: SidebarProps = {}) {
  const navigate = useNavigate();
  const location = useLocation();
  const notes = useStore((s) => s.notes);
  const setNotes = useStore((s) => s.setNotes);
  const collapsed = useStore((s) => s.sidebarCollapsed);
  const [showAllTypes, setShowAllTypes] = useState(false);
  const [selectedThread, setSelectedThread] = useState<{
    project: string;
    thread: string;
  } | null>(null);

  const threads = useMemo(() => deriveThreadsFromNotes(notes), [notes]);

  useEffect(() => {
    api.notes
      .list()
      .then(setNotes)
      .catch(() => {});
  }, [setNotes]);

  return (
    <nav
      data-testid="sidebar"
      className={`flex flex-col border-r border-[var(--border)] bg-[var(--bg-secondary)] ${collapsed ? "w-0 overflow-hidden" : "w-56"} transition-all`}
    >
      <div className="p-3 text-xs tracking-widest uppercase text-[var(--text-muted)]">
        Scrypt
      </div>

      <div className="flex flex-col gap-0.5 px-2">
        {NAV_ITEMS.map((item) => {
          const isActive =
            location.pathname === item.path ||
            (item.path === "/journal" && location.pathname === "/");
          return (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              aria-current={isActive ? "page" : undefined}
              className={`text-left px-2 py-1 text-sm rounded ${
                isActive
                  ? "bg-[var(--bg-tertiary)] text-[var(--text-primary)]"
                  : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              }`}
            >
              {item.label}
            </button>
          );
        })}
      </div>

      {onNewNote && (
        <button
          onClick={onNewNote}
          className="mx-2 mt-2 px-3 py-1 text-left text-sm text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] rounded"
        >
          + New note
        </button>
      )}

      <div className="mt-2 px-3 flex items-center justify-between text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
        <span>Projects</span>
        <label className="flex items-center gap-1 normal-case tracking-normal cursor-pointer">
          <input
            type="checkbox"
            checked={showAllTypes}
            onChange={(e) => setShowAllTypes(e.target.checked)}
            className="accent-[var(--text-secondary)]"
          />
          <span>Show all types</span>
        </label>
      </div>

      <ThreadChips
        threads={threads}
        selected={selectedThread}
        onSelect={setSelectedThread}
      />

      <div className="flex-1 overflow-y-auto px-2 py-1">
        <FolderTree
          notes={notes}
          thread={selectedThread}
          showAllTypes={showAllTypes}
          currentPath={location.pathname}
          onNoteClick={(p) => navigate(`/note/${p}`)}
        />
      </div>

      <button
        onClick={() => navigate("/settings")}
        className="px-3 py-2 text-left text-sm text-[var(--text-muted)] hover:text-[var(--text-secondary)] border-t border-[var(--border)]"
      >
        Settings
      </button>
    </nav>
  );
}
