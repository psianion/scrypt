import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import "./RelatedPanel.css";

interface RelatedItem {
  path: string;
  title?: string;
}

interface RelatedData {
  notes: RelatedItem[];
  memories: RelatedItem[];
  draft_prompts: RelatedItem[];
}

/**
 * RelatedPanel — right-rail listing of notes / memories / draft prompts that
 * relate to the current day. Renders inside a scrollable host (JournalView's
 * `<aside>`), so this component only owns row layout. Uses mono for vault
 * paths and the standard sidebar micro-label for section headings.
 */
export function RelatedPanel() {
  const [data, setData] = useState<RelatedData | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    fetch("/api/daily_context")
      .then((r) => r.json())
      .then((resp) => setData(resp.related ?? null))
      .catch(() => setData(null));
  }, []);

  if (!data) return null;

  const sections: { title: string; items: RelatedItem[] }[] = [
    { title: "Related notes", items: data.notes ?? [] },
    { title: "Active memories", items: data.memories ?? [] },
    { title: "Draft prompts", items: data.draft_prompts ?? [] },
  ].filter((s) => s.items.length > 0);

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
