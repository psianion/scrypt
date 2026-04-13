import { useEffect, useState } from "react";
import { useNavigate } from "react-router";

interface RelatedItem {
  path: string;
  title?: string;
}

interface RelatedData {
  notes: RelatedItem[];
  memories: RelatedItem[];
  draft_prompts: RelatedItem[];
}

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
    <div className="p-3 space-y-4 text-sm">
      {sections.map((s) => (
        <div key={s.title}>
          <div className="text-xs uppercase text-[var(--text-muted)] mb-1">
            {s.title}
          </div>
          {s.items.map((it) => (
            <button
              key={it.path}
              onClick={() => navigate(`/note/${it.path}`)}
              className="block w-full text-left text-[var(--text-secondary)] hover:text-[var(--text-primary)] truncate"
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
