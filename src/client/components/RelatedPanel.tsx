import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import "./RelatedPanel.css";

export interface RelatedItem {
  path: string;
  title?: string;
}

export interface RelatedData {
  notes: RelatedItem[];
  memories: RelatedItem[];
  draft_prompts: RelatedItem[];
}

interface RelatedPanelProps {
  /** When provided, the panel renders these sections directly. When omitted,
   * the panel falls back to its own `/api/daily_context` fetch (legacy
   * stand-alone usage — JournalView now hoists the fetch so it can collapse
   * the surrounding aside when there's nothing to show). */
  data?: RelatedData | null;
}

/**
 * RelatedPanel — right-rail listing of notes / memories / draft prompts that
 * relate to the current day. Renders inside a scrollable host (JournalView's
 * `<aside>`), so this component only owns row layout. Uses mono for vault
 * paths and the standard sidebar micro-label for section headings.
 *
 * Returns `null` when there are no sections to show, so callers can detect
 * "empty" via `relatedHasSections(data)` and collapse the aside.
 */
export function RelatedPanel({ data: dataProp }: RelatedPanelProps = {}) {
  const [internal, setInternal] = useState<RelatedData | null>(null);
  const navigate = useNavigate();
  const useInternal = dataProp === undefined;

  useEffect(() => {
    if (!useInternal) return;
    fetch("/api/daily_context")
      .then((r) => r.json())
      .then((resp) => setInternal(resp.related ?? null))
      .catch(() => setInternal(null));
  }, [useInternal]);

  const data = useInternal ? internal : dataProp;
  if (!data) return null;

  const sections = relatedSections(data);
  if (sections.length === 0) return null;

  return (
    <div className="related-panel" data-testid="related-panel">
      {sections.map((s) => (
        <div key={s.title} className="related-section">
          <div className="related-section-label">{s.title}</div>
          {s.items.map((it) => (
            <button
              key={it.path}
              type="button"
              className="related-item"
              onClick={() => navigate(`/note/${it.path}`)}
              title={it.path}
            >
              {it.title ?? it.path}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

/** True when `data` would produce at least one rendered section. */
export function relatedHasSections(data: RelatedData | null): boolean {
  if (!data) return false;
  return relatedSections(data).length > 0;
}

function relatedSections(
  data: RelatedData,
): { title: string; items: RelatedItem[] }[] {
  return [
    { title: "Related notes", items: data.notes ?? [] },
    { title: "Active memories", items: data.memories ?? [] },
    { title: "Draft prompts", items: data.draft_prompts ?? [] },
  ].filter((s) => s.items.length > 0);
}
