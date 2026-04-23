// src/client/views/SearchView.tsx
//
// Full-text + semantic search over the vault. The row layout surfaces
// title as primary, slug grey-secondary, breadcrumb path last (§6.1.1).
// Active project/doc_type/thread chips are forwarded as query params to
// `/api/graph/search` which post-filters hits by the denormalised columns
// (plan Task 12).

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { api } from "../api";
import { useStore } from "../store";
import { deriveProjectDocType } from "../components/FolderTree.helpers";

export interface SearchFilters {
  project?: string | null;
  doc_type?: string | null;
  thread?: string | null;
}

interface SearchResultRow {
  path: string;
  title: string;
  slug: string;
  project: string | null;
  doc_type: string | null;
}

interface SearchViewProps {
  defaultFilters?: SearchFilters;
}

function slugFromPath(path: string): string {
  const last = path.split("/").pop() ?? path;
  return last.replace(/\.md$/i, "");
}

function hitToRow(hit: { path: string; title: string }): SearchResultRow {
  const { project, doc_type } = deriveProjectDocType(hit.path);
  return {
    path: hit.path,
    title: hit.title,
    slug: slugFromPath(hit.path),
    project,
    doc_type,
  };
}

export function SearchView({ defaultFilters }: SearchViewProps = {}) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<SearchFilters>(defaultFilters ?? {});
  const [results, setResults] = useState<SearchResultRow[]>([]);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const res = await api.graphSearch(q, {
          project: filters.project ?? null,
          doc_type: filters.doc_type ?? null,
          thread: filters.thread ?? null,
        });
        if (cancelled) return;
        setResults(res.hits.map(hitToRow));
      } catch (err) {
        if ((err as { name?: string })?.name === "AbortError") return;
        console.warn("[search] failed:", err);
        if (!cancelled) setResults([]);
      }
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, filters.project, filters.doc_type, filters.thread]);

  const activeChips = useMemo(() => {
    const out: Array<{ label: string; key: keyof SearchFilters; value: string }> = [];
    if (filters.project) out.push({ label: `project: ${filters.project}`, key: "project", value: filters.project });
    if (filters.doc_type) out.push({ label: `type: ${filters.doc_type}`, key: "doc_type", value: filters.doc_type });
    if (filters.thread) out.push({ label: `thread: ${filters.thread}`, key: "thread", value: filters.thread });
    return out;
  }, [filters]);

  const clearFilter = (key: keyof SearchFilters) => {
    setFilters((prev) => ({ ...prev, [key]: null }));
  };

  return (
    <div data-testid="search-view" className="flex flex-col h-full p-4">
      <input
        role="searchbox"
        type="search"
        placeholder="Search notes..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="w-full px-3 py-2 mb-2 text-sm bg-[var(--bg-secondary)] border border-[var(--border)] rounded text-[var(--text-primary)] outline-none"
      />

      {activeChips.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-3">
          {activeChips.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => clearFilter(c.key)}
              className="text-[11px] px-2 py-0.5 rounded-full border bg-[var(--bg-tertiary)] text-[var(--text-primary)] border-[var(--border)] hover:text-[var(--text-muted)]"
              title={`Remove ${c.key} filter`}
            >
              <span>{c.label}</span>
              <span className="ml-1 opacity-60">×</span>
            </button>
          ))}
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {results.map((r) => (
          <button
            key={r.path}
            data-result-row=""
            onClick={() => {
              useStore.getState().openTab(r.path, r.title);
              navigate(`/note/${r.path}`);
            }}
            className="block w-full text-left p-3 mb-1 rounded hover:bg-[var(--bg-tertiary)]"
          >
            <div className="text-sm text-[var(--text-primary)]">{r.title}</div>
            <div
              data-slug=""
              className="text-xs text-[var(--text-muted)] mt-0.5"
            >
              {r.slug}
            </div>
            <div
              data-path=""
              className="text-[10px] text-[var(--text-muted)] mt-0.5 truncate"
            >
              {r.project && r.doc_type
                ? `${r.project} / ${r.doc_type} / ${r.slug}`
                : r.path}
              <span className="opacity-40"> — {r.path}</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
