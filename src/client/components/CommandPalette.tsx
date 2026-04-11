import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router";
import { useStore } from "../store";
import { api } from "../api";
import type { SearchResult } from "../../shared/types";

export function CommandPalette() {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selected, setSelected] = useState(0);
  const notes = useStore((s) => s.notes);
  const togglePalette = useStore((s) => s.toggleCommandPalette);
  const openTab = useStore((s) => s.openTab);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!query) {
      setResults(notes.slice(0, 10).map((n) => ({ path: n.path, title: n.title, snippet: "" })));
      return;
    }
    const timer = setTimeout(async () => {
      const r = await api.search(query);
      setResults(r);
      setSelected(0);
    }, 150);
    return () => clearTimeout(timer);
  }, [query, notes]);

  function selectResult(result: SearchResult) {
    openTab(result.path, result.title);
    navigate(`/note/${result.path}`);
    togglePalette();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      togglePalette();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((s) => Math.min(s + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((s) => Math.max(s - 1, 0));
    } else if (e.key === "Enter" && results[selected]) {
      selectResult(results[selected]);
    }
  }

  return (
    <div
      data-testid="command-palette"
      className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh] bg-black/60"
      onClick={() => togglePalette()}
    >
      <div
        className="w-[560px] bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          type="text"
          placeholder="Search notes..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          className="w-full px-4 py-3 bg-transparent text-[var(--text-primary)] text-sm outline-none border-b border-[var(--border)]"
        />
        <div className="max-h-80 overflow-y-auto">
          {results.map((result, i) => (
            <button
              key={result.path}
              onClick={() => selectResult(result)}
              className={`w-full text-left px-4 py-2 text-sm ${
                i === selected
                  ? "bg-[var(--bg-tertiary)] text-[var(--text-primary)]"
                  : "text-[var(--text-secondary)]"
              }`}
            >
              <div className="font-medium">{result.title}</div>
              {result.snippet && (
                <div className="text-xs text-[var(--text-muted)] truncate mt-0.5">
                  {result.snippet}
                </div>
              )}
            </button>
          ))}
          {results.length === 0 && query && (
            <div className="px-4 py-3 text-sm text-[var(--text-muted)]">No results</div>
          )}
        </div>
      </div>
    </div>
  );
}
