import { useNavigate } from "react-router";
import { useStore } from "../store";

export function TabBar() {
  const tabs = useStore((s) => s.tabs);
  const activeTab = useStore((s) => s.activeTab);
  const closeTab = useStore((s) => s.closeTab);
  const setActiveTab = useStore((s) => s.setActiveTab);
  const navigate = useNavigate();

  if (tabs.length === 0) return <div data-testid="tab-bar" />;

  return (
    <div
      data-testid="tab-bar"
      className="flex border-b border-[var(--border)] bg-[var(--bg-secondary)] overflow-x-auto"
    >
      {tabs.map((tab) => (
        <div
          key={tab.path}
          className={`flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer border-r border-[var(--border)] ${
            activeTab === tab.path
              ? "bg-[var(--bg-primary)] text-[var(--text-primary)]"
              : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          }`}
          onClick={() => {
            setActiveTab(tab.path);
            navigate(`/note/${tab.path}`);
          }}
        >
          <span className="truncate max-w-32">{tab.title}</span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              closeTab(tab.path);
            }}
            className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          >
            x
          </button>
        </div>
      ))}
    </div>
  );
}
