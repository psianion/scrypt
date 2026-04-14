// src/client/views/JournalView.tsx
import { useEffect, useState } from "react";
import { api } from "../api";
import type { Note } from "../../shared/types";
import { RelatedPanel } from "../components/RelatedPanel";
import { ActivityStrip } from "../components/ActivityStrip";

export function JournalView() {
  const [note, setNote] = useState<Note | null>(null);
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split("T")[0]);

  useEffect(() => {
    if (selectedDate === new Date().toISOString().split("T")[0]) {
      api.journal.today().then(setNote).catch(() => setNote(null));
    } else {
      api.journal.get(selectedDate).then(setNote).catch(() => setNote(null));
    }
  }, [selectedDate]);

  return (
    <div data-testid="journal-view" className="flex h-full">
      <div className="flex flex-col flex-1 min-w-0 p-4">
        <div className="flex items-center gap-3 mb-4">
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="px-2 py-1 text-sm bg-[var(--bg-secondary)] border border-[var(--border)] rounded text-[var(--text-primary)]"
          />
          <button
            onClick={() => setSelectedDate(new Date().toISOString().split("T")[0])}
            className="px-3 py-1 text-sm bg-[var(--bg-tertiary)] text-[var(--text-secondary)] rounded hover:text-[var(--text-primary)]"
          >
            Today
          </button>
          <span className="text-sm text-[var(--text-muted)]">{selectedDate}</span>
        </div>

        <div className="flex-1 overflow-y-auto">
          {note ? (
            <div className="prose prose-invert max-w-none">
              <pre className="whitespace-pre-wrap text-sm text-[var(--text-primary)]">
                {note.content}
              </pre>
            </div>
          ) : (
            <div className="text-[var(--text-muted)]">No journal entry for this date.</div>
          )}
        </div>
      </div>
      <aside className="w-[260px] border-l border-[var(--border)] overflow-y-auto flex flex-col">
        <div className="flex-1 overflow-y-auto">
          <RelatedPanel />
        </div>
        <ActivityStrip />
      </aside>
    </div>
  );
}
