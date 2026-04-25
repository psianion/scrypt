import { useNavigate, useLocation } from "react-router";
import { useEffect, useMemo, useState, type ComponentType, type SVGProps } from "react";
import {
  ChevronsDownUp,
  Database,
  FileText,
  Hash,
  Home,
  ListChecks,
  Network,
  Plus,
  RotateCw,
  Search,
  Settings as SettingsIcon,
} from "lucide-react";
import { useStore } from "../store";
import { api } from "../api";
import { FolderTree } from "./FolderTree";
import { topLevelProjects } from "./FolderTree.helpers";
import { ThreadChips, deriveThreadsFromNotes } from "./ThreadChips";
import { ContextMenu, type ContextMenuPosition } from "../ui";
import "./Sidebar.css";

type LucideIcon = ComponentType<SVGProps<SVGSVGElement> & { size?: number | string; strokeWidth?: number | string }>;

interface NavItem {
  label: string;
  path: string;
  icon: LucideIcon;
}

const NAV_ITEMS: NavItem[] = [
  { label: "Journal", path: "/journal", icon: Home },
  { label: "Notes", path: "/notes", icon: FileText },
  { label: "Tasks", path: "/tasks", icon: ListChecks },
  { label: "Search", path: "/search", icon: Search },
  { label: "Graph", path: "/graph", icon: Network },
  { label: "Data", path: "/data", icon: Database },
  { label: "Tags", path: "/tags", icon: Hash },
];

const FOLDER_TREE_EXPANDED_KEY = "scrypt.sidebar.expanded";

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
  // Project pill filter — when set, FolderTree narrows to that top-level
  // vault folder. Toggles off when the same chip is clicked again.
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [treeMenu, setTreeMenu] = useState<ContextMenuPosition | null>(null);
  // Bumped after "Collapse all" to force FolderTree to re-read localStorage.
  const [folderTreeKey, setFolderTreeKey] = useState(0);

  const threads = useMemo(() => deriveThreadsFromNotes(notes), [notes]);
  // Project chips source from the user's top-level vault folders. See
  // `topLevelProjects` for the rules (housekeeping folders excluded, both
  // ingest-v3 `projects/<p>/...` and legacy `<top>/...` layouts supported).
  const projects = useMemo(() => topLevelProjects(notes), [notes]);

  useEffect(() => {
    let cancelled = false;
    api.notes
      .list()
      .then((list) => {
        if (!cancelled) setNotes(list);
      })
      .catch(() => {
        /* sidebar survives API errors — leave notes empty */
      });
    return () => {
      cancelled = true;
    };
  }, [setNotes]);

  function reload(): void {
    api.notes
      .list()
      .then(setNotes)
      .catch(() => {});
  }

  function collapseAllFolders(): void {
    try {
      localStorage.removeItem(FOLDER_TREE_EXPANDED_KEY);
    } catch {
      /* storage disabled — ignore */
    }
    setFolderTreeKey((k) => k + 1);
  }

  if (collapsed) {
    return (
      <nav
        data-testid="sidebar"
        className="sidebar sidebar--collapsed"
        aria-hidden="true"
      />
    );
  }

  const isJournalActive =
    location.pathname === "/journal" || location.pathname === "/";
  const isSettingsActive = location.pathname === "/settings";

  return (
    <nav data-testid="sidebar" className="sidebar">
      <div className="sidebar-brand">Scrypt</div>

      <div className="sidebar-section">
        <div className="sidebar-label">Navigate</div>
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive =
            item.path === "/journal"
              ? isJournalActive
              : location.pathname === item.path;
          return (
            <button
              key={item.path}
              type="button"
              className="sidebar-item"
              data-active={isActive ? "" : undefined}
              aria-current={isActive ? "page" : undefined}
              onClick={() => navigate(item.path)}
            >
              <Icon size={16} strokeWidth={1.75} aria-hidden="true" />
              <span className="sidebar-item-label">{item.label}</span>
            </button>
          );
        })}

        {onNewNote && (
          <button
            type="button"
            className="sidebar-item sidebar-item--new"
            onClick={onNewNote}
          >
            <Plus size={16} strokeWidth={1.75} aria-hidden="true" />
            <span className="sidebar-item-label">New note</span>
          </button>
        )}
      </div>

      <div className="sidebar-section sidebar-section--projects">
        <div className="sidebar-projects-header">
          <span className="sidebar-label">Projects</span>
          <label className="sidebar-show-all">
            <input
              type="checkbox"
              checked={showAllTypes}
              onChange={(e) => setShowAllTypes(e.target.checked)}
            />
            <span>Show all types</span>
          </label>
        </div>

        {projects.length > 0 ? (
          <div
            className="sidebar-projects"
            data-testid="sidebar-projects"
            role="tablist"
            aria-label="Project filter"
          >
            {projects.map((p) => {
              const active = selectedProject === p;
              return (
                <button
                  key={p}
                  type="button"
                  className="sidebar-project-chip"
                  data-active={active ? "" : undefined}
                  data-testid={`sidebar-project-${p}`}
                  role="tab"
                  aria-selected={active}
                  onClick={() =>
                    setSelectedProject((cur) => (cur === p ? null : p))
                  }
                >
                  {p}
                </button>
              );
            })}
          </div>
        ) : null}

        <ThreadChips
          threads={threads}
          selected={selectedThread}
          onSelect={setSelectedThread}
        />

        <div
          className="sidebar-tree"
          data-testid="sidebar-tree"
          onContextMenu={(ev) => {
            ev.preventDefault();
            setTreeMenu({ x: ev.clientX, y: ev.clientY });
          }}
        >
          <FolderTree
            key={folderTreeKey}
            notes={notes}
            thread={selectedThread}
            project={selectedProject}
            showAllTypes={showAllTypes}
            currentPath={location.pathname}
            onNoteClick={(p) => navigate(`/note/${p}`)}
          />
        </div>
      </div>

      <button
        type="button"
        className="sidebar-item sidebar-item--footer"
        data-active={isSettingsActive ? "" : undefined}
        aria-current={isSettingsActive ? "page" : undefined}
        onClick={() => navigate("/settings")}
      >
        <SettingsIcon size={16} strokeWidth={1.75} aria-hidden="true" />
        <span className="sidebar-item-label">Settings</span>
      </button>

      {treeMenu && (
        <ContextMenu
          open
          position={treeMenu}
          aria-label="Project tree actions"
          onClose={() => setTreeMenu(null)}
          items={[
            {
              id: "refresh",
              label: "Refresh",
              icon: <RotateCw size={14} strokeWidth={1.75} aria-hidden="true" />,
              onSelect: () => {
                reload();
                setTreeMenu(null);
              },
            },
            {
              id: "collapse-all",
              label: "Collapse all",
              icon: (
                <ChevronsDownUp
                  size={14}
                  strokeWidth={1.75}
                  aria-hidden="true"
                />
              ),
              onSelect: () => {
                collapseAllFolders();
                setTreeMenu(null);
              },
            },
          ]}
        />
      )}
    </nav>
  );
}
