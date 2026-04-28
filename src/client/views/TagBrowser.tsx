import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { api } from "../api";

interface TagEntry {
  tag: string;
  count: number;
}

export function TagBrowser() {
  const navigate = useNavigate();
  const [tags, setTags] = useState<TagEntry[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    api.searchTags("").then(setTags).catch(() => {});
  }, []);

  const parents = new Map<string, TagEntry[]>();
  const topLevel: TagEntry[] = [];

  for (const tag of tags) {
    const slash = tag.tag.indexOf("/");
    if (slash !== -1) {
      const parent = tag.tag.slice(0, slash);
      if (!parents.has(parent)) parents.set(parent, []);
      parents.get(parent)!.push(tag);
    } else {
      topLevel.push(tag);
    }
  }

  // Include parent-only groups that don't have a top-level entry
  for (const parent of parents.keys()) {
    if (!topLevel.some((t) => t.tag === parent)) {
      const count = parents.get(parent)!.reduce((a, b) => a + b.count, 0);
      topLevel.push({ tag: parent, count });
    }
  }

  function toggle(tag: string) {
    const next = new Set(expanded);
    if (next.has(tag)) next.delete(tag);
    else next.add(tag);
    setExpanded(next);
  }

  return (
    <div data-testid="tag-browser" className="p-4">
      <div className="text-xs uppercase tracking-wide text-[var(--text-muted)] mb-3">
        Tags
      </div>
      {topLevel.map((tag) => {
        const children = parents.get(tag.tag) || [];
        return (
          <div key={tag.tag} className="mb-1">
            <button
              onClick={() =>
                children.length > 0
                  ? toggle(tag.tag)
                  : navigate(`/search?tag=${tag.tag}`)
              }
              className="flex items-center gap-2 w-full text-left px-2 py-1 text-sm rounded hover:bg-[var(--surface-hover)]"
            >
              {children.length > 0 && (
                <span className="text-[var(--text-muted)]">
                  {expanded.has(tag.tag) ? "▼" : "▶"}
                </span>
              )}
              <span className="text-[var(--text)]">{tag.tag}</span>
              <span className="text-[var(--text-muted)] text-xs ml-auto">
                {tag.count}
              </span>
            </button>
            {expanded.has(tag.tag) &&
              children.map((child) => (
                <button
                  key={child.tag}
                  onClick={() => navigate(`/search?tag=${child.tag}`)}
                  className="flex items-center gap-2 w-full text-left pl-8 pr-2 py-0.5 text-sm text-[var(--text-muted)] hover:text-[var(--text)]"
                >
                  <span>{child.tag.split("/").pop()}</span>
                  <span className="text-[var(--text-muted)] text-xs ml-auto">
                    {child.count}
                  </span>
                </button>
              ))}
          </div>
        );
      })}
    </div>
  );
}
