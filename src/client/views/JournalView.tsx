// src/client/views/JournalView.tsx
import { useEffect, useState } from "react";
import { api } from "../api";
import type { Note } from "../../shared/types";
import {
  RelatedPanel,
  relatedHasSections,
  type RelatedData,
} from "../components/RelatedPanel";
import { ActivityStrip } from "../components/ActivityStrip";
import { useEmbeddingProgress } from "../stores/embeddingProgress";

export function JournalView() {
  const [note, setNote] = useState<Note | null>(null);
  const [related, setRelated] = useState<RelatedData | null>(null);
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split("T")[0]);

  // Render the right-rail aside only when there's something in it.
  // Otherwise an empty 260px column eats the journal's reading width.
  const hasRelated = relatedHasSections(related);
  const hasActivity = useEmbeddingProgress(
    (s) => Object.keys(s.inFlight).length > 0,
  );
  const showAside = hasRelated || hasActivity;

  useEffect(() => {
    if (selectedDate === new Date().toISOString().split("T")[0]) {
      api.journal.today().then(setNote).catch(() => setNote(null));
    } else {
      api.journal.get(selectedDate).then(setNote).catch(() => setNote(null));
    }
  }, [selectedDate]);

  // Hoisted from RelatedPanel so we can decide whether to render the aside
  // before paint, and so we re-fetch when the user moves between days.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/daily_context")
      .then((r) => r.json())
      .then((resp) => {
        if (!cancelled) setRelated(resp.related ?? null);
      })
      .catch(() => {
        if (!cancelled) setRelated(null);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedDate]);

  return (
    <div data-testid="journal-view" className="flex h-full">
      <div className="flex flex-col flex-1 min-w-0 p-4">
        <div className="flex items-center gap-3 mb-4">
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="px-2 py-1 text-sm bg-[var(--surface)] border border-[var(--border)] rounded text-[var(--text)]"
          />
          <button
            onClick={() => setSelectedDate(new Date().toISOString().split("T")[0])}
            className="px-3 py-1 text-sm bg-[var(--surface-hover)] text-[var(--text-muted)] rounded hover:text-[var(--text)]"
          >
            Today
          </button>
          <span className="text-sm text-[var(--text-muted)]">{selectedDate}</span>
        </div>

        <div className="flex-1 overflow-y-auto">
          {note ? (
            <div className="prose prose-invert max-w-none">
              <pre className="whitespace-pre-wrap text-sm text-[var(--text)]">
                {note.content}
              </pre>
            </div>
          ) : (
            <div className="text-[var(--text-muted)]">No journal entry for this date.</div>
          )}
        </div>
      </div>
      {showAside ? (
        <aside
          data-testid="journal-aside"
          className="w-[260px] border-l border-[var(--border-subtle)] flex flex-col overflow-hidden"
        >
          <div className="flex-1 min-h-0 overflow-y-auto">
            <RelatedPanel data={related} />
          </div>
          <ActivityStrip />
        </aside>
      ) : null}
    </div>
  );
}
