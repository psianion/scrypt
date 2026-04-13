import { useNavigate, useLocation } from "react-router";
import { useEffect } from "react";
import { useStore } from "../store";
import { api } from "../api";
import { FolderTree } from "./FolderTree";

const NAV_ITEMS = [
  { label: "Notes", path: "/notes" },
  { label: "Journal", path: "/journal" },
  { label: "Tasks", path: "/tasks" },
  { label: "Graph", path: "/graph" },
  { label: "Data", path: "/data" },
  { label: "Tags", path: "/tags" },
];

export function Sidebar() {
  const navigate = useNavigate();
  const location = useLocation();
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
        <FolderTree />
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
