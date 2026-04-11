// src/client/views/SearchView.tsx
import { useState, useEffect } from "react";
import { useNavigate } from "react-router";
import { api } from "../api";
import { useStore } from "../store";
import type { SearchResult } from "../../shared/types";

export function SearchView() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);

  useEffect(() => {
    if (!query) { setResults([]); return; }
    const timer = setTimeout(async () => {
      const r = await api.search(query);
      setResults(r);
    }, 200);
    return () => clearTimeout(timer);
  }, [query]);

  return (
    <div data-testid="search-view" className="flex flex-col h-full p-4">
      <input
        type="text"
        placeholder="Search notes..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="w-full px-3 py-2 mb-4 text-sm bg-[var(--bg-secondary)] border border-[var(--border)] rounded text-[var(--text-primary)] outline-none"
      />

      <div className="flex-1 overflow-y-auto">
        {results.map((r) => (
          <button
            key={r.path}
            onClick={() => {
              useStore.getState().openTab(r.path, r.title);
              navigate(`/note/${r.path}`);
            }}
            className="block w-full text-left p-3 mb-1 rounded hover:bg-[var(--bg-tertiary)]"
          >
            <div className="text-sm text-[var(--text-primary)]">{r.title}</div>
            <div className="text-xs text-[var(--text-muted)] mt-0.5" dangerouslySetInnerHTML={{ __html: r.snippet }} />
            <div className="text-xs text-[var(--text-muted)] mt-0.5">{r.path}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
