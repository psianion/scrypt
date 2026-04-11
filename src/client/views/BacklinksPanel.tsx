import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { useStore } from "../store";
import { api } from "../api";
import type { Backlink } from "../../shared/types";

export function BacklinksPanel() {
  const navigate = useNavigate();
  const currentNote = useStore((s) => s.currentNote);
  const [backlinks, setBacklinks] = useState<Backlink[]>([]);

  useEffect(() => {
    if (!currentNote) { setBacklinks([]); return; }
    api.backlinks(currentNote.path).then(setBacklinks).catch(() => setBacklinks([]));
  }, [currentNote?.path]);

  return (
    <aside
      data-testid="backlinks-panel"
      className="w-56 border-l border-[var(--border)] bg-[var(--bg-secondary)] overflow-y-auto p-3"
    >
      <div className="text-xs uppercase tracking-wide text-[var(--text-muted)] mb-2">
        Backlinks ({backlinks.length})
      </div>

      {backlinks.length === 0 ? (
        <div className="text-sm text-[var(--text-muted)]">No backlinks</div>
      ) : (
        <div className="flex flex-col gap-2">
          {backlinks.map((bl) => (
            <button
              key={bl.sourcePath}
              onClick={() => {
                useStore.getState().openTab(bl.sourcePath, bl.sourceTitle);
                navigate(`/note/${bl.sourcePath}`);
              }}
              className="text-left p-2 rounded bg-[var(--bg-tertiary)] hover:bg-[var(--border)]"
            >
              <div className="text-sm text-[var(--text-primary)]">{bl.sourceTitle}</div>
              <div className="text-xs text-[var(--text-muted)] mt-0.5 truncate">{bl.context}</div>
            </button>
          ))}
        </div>
      )}
    </aside>
  );
}
