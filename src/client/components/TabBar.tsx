import { useNavigate } from "react-router";
import { X } from "lucide-react";
import { useStore } from "../store";
import "./TabBar.css";

/**
 * TabBar — open-tab strip rendered above the editor surface.
 *
 * Visuals copied verbatim from `docs/pencils/03-navigation-overlays.md §Tab Bar`.
 * State lives in the Zustand store (`tabs`, `activeTab`, `setActiveTab`,
 * `closeTab`); routing is delegated to react-router's `useNavigate`.
 *
 * `data-active` drives the active-tab styling. `data-dirty` is wired into the
 * CSS for future use once the store tracks unsaved-edit state.
 */
export function TabBar() {
  const tabs = useStore((s) => s.tabs);
  const activeTab = useStore((s) => s.activeTab);
  const closeTab = useStore((s) => s.closeTab);
  const setActiveTab = useStore((s) => s.setActiveTab);
  const navigate = useNavigate();

  if (tabs.length === 0) return <div className="tab-bar" data-testid="tab-bar" />;

  return (
    <div className="tab-bar" data-testid="tab-bar" role="tablist">
      {tabs.map((tab) => {
        const isActive = activeTab === tab.path;
        return (
          <div
            key={tab.path}
            className="tab"
            role="tab"
            tabIndex={0}
            aria-selected={isActive}
            data-active={isActive ? "" : undefined}
            data-testid={`tab-${tab.path}`}
            onClick={() => {
              setActiveTab(tab.path);
              navigate(`/note/${tab.path}`);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setActiveTab(tab.path);
                navigate(`/note/${tab.path}`);
              }
            }}
          >
            <span className="tab-name">{tab.title}</span>
            <button
              type="button"
              className="tab-close"
              aria-label={`Close ${tab.title}`}
              onClick={(e) => {
                e.stopPropagation();
                closeTab(tab.path);
              }}
            >
              <X size={12} strokeWidth={2} aria-hidden />
            </button>
          </div>
        );
      })}
    </div>
  );
}
