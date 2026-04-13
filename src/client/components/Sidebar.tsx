import { useNavigate, useLocation } from "react-router";
import { useEffect } from "react";
import { useStore } from "../store";
import { api } from "../api";

const NAV_ITEMS = [
  { label: "Notes", path: "/notes" },
  { label: "Journal", path: "/journal" },
  { label: "Tasks", path: "/tasks" },
  { label: "Graph", path: "/graph" },
  { label: "Data", path: "/data" },
  { label: "Tags", path: "/tags" },
];

const SIDEBAR_GROUPS = [
  { label: "THREADS", prefix: "notes/threads/" },
  { label: "RESEARCH", prefix: "notes/research/" },
  { label: "MEMORY", prefix: "memory/" },
  { label: "INBOX", prefix: "notes/inbox/" },
  { label: "IDEAS", prefix: "notes/ideas/" },
  { label: "THOUGHTS", prefix: "notes/thoughts/" },
  { label: "LOGS", prefix: "notes/logs/" },
  { label: "DOCS", prefix: "docs/" },
];

function SidebarFiles() {
  const notes = useStore((s) => s.notes);
  const navigate = useNavigate();

  return (
    <>
      {SIDEBAR_GROUPS.map((group) => {
        const items = notes
          .filter((n) => n.path.startsWith(group.prefix))
          .sort((a, b) =>
            (b.modified ?? "").localeCompare(a.modified ?? ""),
          )
          .slice(0, 20);
        if (items.length === 0) return null;
        return (
          <div key={group.label} className="mt-3">
            <div className="text-xs uppercase tracking-wide text-[var(--text-muted)] px-2 mb-1">
              {group.label}
            </div>
            {items.map((n) => (
              <button
                key={n.path}
                onClick={() => {
                  useStore.getState().openTab(n.path, n.title);
                  navigate(`/note/${n.path}`);
                }}
                className="block w-full text-left px-2 py-0.5 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] truncate"
              >
                {n.title}
              </button>
            ))}
          </div>
        );
      })}
    </>
  );
}

export function Sidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const notes = useStore((s) => s.notes);
  const setNotes = useStore((s) => s.setNotes);
  const collapsed = useStore((s) => s.sidebarCollapsed);

  useEffect(() => {
    api.notes.list().then(setNotes).catch(() => {});
  }, []);

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

      <div className="flex-1 overflow-y-auto px-2 py-1">
        <SidebarFiles />
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
