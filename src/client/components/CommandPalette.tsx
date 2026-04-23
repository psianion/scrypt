import { useState, useEffect, useMemo, useRef } from "react";
import { useNavigate } from "react-router";
import { useStore } from "../store";
import { api } from "../api";
import type { SearchResult } from "../../shared/types";
import { DOC_TYPES } from "../../server/vocab/doc-types";
import { deriveProjectDocType } from "./FolderTree.helpers";

interface CommandPaletteProps {
  /** Path of the currently active note. When omitted, falls back to
   * `store.activeTab`. Drives availability of path-specific actions like
   * "Move to project". */
  currentPath?: string;
  /** Custom navigation hook — used by tests. Falls back to react-router's
   * `navigate(/note/<path>)`. */
  onNavigate?: (path: string) => void;
}

export function CommandPalette({
  currentPath,
  onNavigate,
}: CommandPaletteProps = {}) {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selected, setSelected] = useState(0);
  const [moveOpen, setMoveOpen] = useState(false);
  const notes = useStore((s) => s.notes);
  const activeTab = useStore((s) => s.activeTab);
  const togglePalette = useStore((s) => s.toggleCommandPalette);
  const openTab = useStore((s) => s.openTab);

  const notePath = currentPath ?? activeTab ?? null;
  const goTo = (p: string) => {
    if (onNavigate) onNavigate(p);
    else navigate(`/note/${p}`);
  };

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!query) {
      setResults(
        notes.slice(0, 10).map((n) => ({ path: n.path, title: n.title, snippet: "" })),
      );
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
    goTo(result.path);
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

        {notePath && (
          <div className="border-b border-[var(--border)]">
            {!moveOpen ? (
              <button
                type="button"
                onClick={() => setMoveOpen(true)}
                className="w-full text-left px-4 py-2 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]"
              >
                Move to project…
              </button>
            ) : (
              <MoveToProjectForm
                currentPath={notePath}
                onCancel={() => setMoveOpen(false)}
                onMoved={(newPath) => {
                  setMoveOpen(false);
                  goTo(newPath);
                  togglePalette();
                }}
              />
            )}
          </div>
        )}

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

// ─── Move-to-project mini-form ──────────────────────────────────────────
//
// Two selects + Move/Cancel. Current (project, doc_type) prefilled from the
// path. POSTs to `/api/notes/<path>/move` and forwards the server-returned
// `new_path` to `onMoved`, which navigates + closes the palette.

function MoveToProjectForm({
  currentPath,
  onCancel,
  onMoved,
}: {
  currentPath: string;
  onCancel: () => void;
  onMoved: (newPath: string) => void;
}) {
  const derived = useMemo(
    () => deriveProjectDocType(currentPath),
    [currentPath],
  );
  const [project, setProject] = useState(derived.project ?? "");
  const [docType, setDocType] = useState(derived.doc_type ?? "research");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError(null);
    const p = project.trim();
    const dt = docType.trim();
    if (!p || !dt) {
      setError("Project and doc type required");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/notes/${currentPath}/move`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project: p, doc_type: dt }),
      });
      const data = (await res.json().catch(() => null)) as
        | { ok?: boolean; new_path?: string; error?: string }
        | null;
      if (!res.ok) {
        setError(data?.error ?? `move failed (${res.status})`);
        return;
      }
      if (data?.new_path) onMoved(data.new_path);
      else setError("server did not return new_path");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="px-4 py-3 text-sm">
      <div className="text-[var(--text-primary)] font-medium mb-2">
        Move to project
      </div>
      <div className="flex flex-col gap-2">
        <label className="flex items-center gap-2">
          <span className="w-20 text-xs text-[var(--text-muted)]">Project</span>
          <input
            aria-label="Project"
            type="text"
            value={project}
            onChange={(e) => setProject(e.target.value)}
            placeholder="project-slug"
            className="flex-1 px-2 py-1 text-sm bg-[var(--bg-primary)] border border-[var(--border)] rounded text-[var(--text-primary)] outline-none"
          />
        </label>
        <label className="flex items-center gap-2">
          <span className="w-20 text-xs text-[var(--text-muted)]">Doc type</span>
          <select
            aria-label="Doc type"
            value={docType}
            onChange={(e) => setDocType(e.target.value)}
            className="flex-1 px-2 py-1 text-sm bg-[var(--bg-primary)] border border-[var(--border)] rounded text-[var(--text-primary)] outline-none"
          >
            {DOC_TYPES.map((dt) => (
              <option key={dt} value={dt}>
                {dt}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error && (
        <div className="mt-2 text-xs text-red-400" role="alert">
          {error}
        </div>
      )}
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={busy}
          className="px-3 py-1 text-sm rounded bg-[var(--bg-tertiary)] text-[var(--text-primary)] hover:bg-[var(--border)] disabled:opacity-50"
        >
          Move
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="px-3 py-1 text-sm rounded text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
