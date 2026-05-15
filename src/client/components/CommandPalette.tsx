import { useState, useEffect, useMemo, useRef } from "react";
import { useLocation, useNavigate } from "react-router";
import { Search } from "lucide-react";
import { Modal } from "@/client/ui/Modal";
import { Input } from "@/client/ui/Input";
import { Button } from "@/client/ui/Button";
import { Chip, Kbd } from "@/client/ui/Chip";
import { useStore } from "../store";
import { api } from "../api";
import type { SearchResult } from "../../shared/types";
import { DOC_TYPES } from "../../server/vocab/doc-types";
import { deriveProjectDocType } from "./FolderTree.helpers";
import "./CommandPalette.css";

interface CommandPaletteProps {
  /** Path of the currently active note. When omitted, falls back to the
   * current /note/:path route, then to `store.activeTab`. Drives availability
   * of path-specific actions like "Move to project". */
  currentPath?: string;
  /** Custom navigation hook — used by tests. Falls back to react-router's
   * `navigate(/note/<path>)`. */
  onNavigate?: (path: string) => void;
}

/** Extract the vault path from a /note/* location pathname, or null if the
 * current route isn't a note page. */
function notePathFromLocation(pathname: string): string | null {
  const match = pathname.match(/^\/note\/(.+)$/);
  if (!match) return null;
  const raw = match[1];
  if (!raw || raw.length === 0) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/**
 * CommandPalette — Wave 1 rewrite.
 *
 * Wraps the palette in the Wave 1 `<Modal>` primitive (portal, focus trap,
 * Escape + backdrop dismiss). Inner chrome follows
 * `docs/pencils/03-navigation-overlays.md §Command Palette` verbatim. The
 * `<Input>` primitive (Wave 0) hosts the search field with a leading lucide
 * `Search` icon; result rows expose `data-active` for the keyboard-selected
 * item; the footer surfaces `<Kbd>` shortcuts.
 *
 * Keyboard contract: ArrowDown/ArrowUp move selection, Enter opens the
 * highlighted result, Escape closes (delegated to Modal).
 */
export function CommandPalette({
  currentPath,
  onNavigate,
}: CommandPaletteProps = {}) {
  const navigate = useNavigate();
  const location = useLocation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selected, setSelected] = useState(0);
  const [moveOpen, setMoveOpen] = useState(false);
  const notes = useStore((s) => s.notes);
  const activeTab = useStore((s) => s.activeTab);
  const togglePalette = useStore((s) => s.toggleCommandPalette);
  const openTab = useStore((s) => s.openTab);

  const routePath = notePathFromLocation(location.pathname);
  const notePath = currentPath ?? routePath ?? activeTab ?? null;
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
    // Escape is handled by Modal's dismissOnEscape — no need to duplicate.
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((s) => Math.min(s + 1, Math.max(results.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((s) => Math.max(s - 1, 0));
    } else if (e.key === "Enter" && results[selected]) {
      e.preventDefault();
      selectResult(results[selected]);
    }
  }

  return (
    <Modal
      open
      onClose={togglePalette}
      ariaLabel="Command palette"
      size="lg"
      hideCloseButton
      dismissOnBackdrop
      className="command-palette-shell"
    >
      <div data-testid="command-palette" onKeyDown={handleKeyDown}>
        <div className="command-palette-input-wrap">
          <Input
            ref={inputRef}
            type="text"
            value={query}
            placeholder="Search notes..."
            onChange={(e) => setQuery(e.target.value)}
            icon={<Search size={16} aria-hidden />}
            aria-label="Search notes"
            className="command-palette-input"
          />
        </div>

        {notePath && (
          <div role="group" aria-label="Note actions">
            {!moveOpen ? (
              <div className="command-palette-list" style={{ paddingBottom: 0 }}>
                <div className="command-palette-section">Actions</div>
                <div
                  className="command-palette-item"
                  role="button"
                  tabIndex={0}
                  data-testid="action-move-to-project"
                  onClick={() => setMoveOpen(true)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setMoveOpen(true);
                    }
                  }}
                >
                  <Chip variant="tag">Move</Chip>
                  <span className="command-palette-item-title">
                    Move to project…
                  </span>
                </div>
              </div>
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

        <div
          className="command-palette-list"
          role="listbox"
          aria-label="Search results"
        >
          {results.length > 0 ? (
            <>
              <div className="command-palette-section">Notes</div>
              {results.map((result, i) => {
                const isActive = i === selected;
                return (
                  <div
                    key={result.path}
                    className="command-palette-item"
                    role="option"
                    tabIndex={-1}
                    aria-selected={isActive}
                    data-active={isActive ? "" : undefined}
                    data-testid={`result-${result.path}`}
                    onClick={() => selectResult(result)}
                    onMouseEnter={() => setSelected(i)}
                  >
                    <div className="command-palette-item-content">
                      <span className="command-palette-item-title">
                        {result.title}
                      </span>
                      {result.snippet ? (
                        <span className="command-palette-item-snippet">
                          {result.snippet}
                        </span>
                      ) : null}
                    </div>
                    {isActive ? (
                      <span className="command-palette-item-kbds">
                        <Kbd>↵</Kbd>
                      </span>
                    ) : null}
                  </div>
                );
              })}
            </>
          ) : query ? (
            <div className="command-palette-empty" data-testid="result-empty">
              No results
            </div>
          ) : null}
        </div>

        <div className="command-palette-footer">
          <span>
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd> navigate
          </span>
          <span>
            <Kbd>↵</Kbd> open
          </span>
          <span>
            <Kbd>Esc</Kbd> close
          </span>
        </div>
      </div>
    </Modal>
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
    <div className="command-palette-move">
      <div className="command-palette-move-title">Move to project</div>
      <div className="command-palette-move-row">
        <label htmlFor="cp-move-project">Project</label>
        <input
          id="cp-move-project"
          aria-label="Project"
          type="text"
          value={project}
          onChange={(e) => setProject(e.target.value)}
          placeholder="project-slug"
          className="input"
        />
      </div>
      <div className="command-palette-move-row">
        <label htmlFor="cp-move-doctype">Doc type</label>
        <select
          id="cp-move-doctype"
          aria-label="Doc type"
          value={docType}
          onChange={(e) => setDocType(e.target.value)}
        >
          {DOC_TYPES.map((dt) => (
            <option key={dt} value={dt}>
              {dt}
            </option>
          ))}
        </select>
      </div>
      {error ? (
        <div className="command-palette-move-error" role="alert">
          {error}
        </div>
      ) : null}
      <div className="command-palette-move-actions">
        <Button variant="primary" onClick={submit} disabled={busy}>
          Move
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
