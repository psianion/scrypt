import { useEffect, useRef, useState, useCallback } from "react";
import { useLocation } from "react-router";
import { EditorView, keymap } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { useStore } from "../store";
import { api } from "../api";
import type { Note } from "../../shared/types";
import { embeddingOverlay } from "./editor/embeddingOverlay";
import "./editor/embedding-overlay.css";
import { NoteContextPanel } from "../graph/NoteContextPanel";
import { useSyncStatus, syncDotState } from "../stores/syncStatus";
import { ClashResolver } from "./ClashResolver";

export function Editor() {
  const location = useLocation();
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentPathRef = useRef<string | null>(null);
  const [note, setNote] = useState<(Note & { backlinks: any[] }) | null>(null);
  const setCurrentNote = useStore((s) => s.setCurrentNote);
  const notPushed = useSyncStatus((s) => s.notPushed);
  const clashes = useSyncStatus((s) => s.clashes);
  const [resolving, setResolving] = useState(false);

  const notePath = location.pathname.replace("/note/", "");
  useEffect(() => { setResolving(false); }, [notePath]);
  currentPathRef.current = notePath || null;

  const isClash = notePath ? syncDotState(notePath, notPushed, clashes) === "clash" : false;

  const saveNote = useCallback(async () => {
    if (!viewRef.current || !notePath) return;
    const content = viewRef.current.state.doc.toString();
    await api.notes.update(notePath, { content });
    // Refresh local push-state immediately, and re-check the hub so the
    // SyncBar pull/clash counts and the in-note clash banner reflect the save
    // (F10). Hub check is best-effort and non-blocking.
    void useSyncStatus.getState().refreshLocal();
    void useSyncStatus.getState().refreshHub();
  }, [notePath]);

  useEffect(() => {
    if (!notePath) return;
    api.notes.get(notePath).then((n) => {
      setNote(n);
      setCurrentNote(n);
    }).catch(() => {});
  }, [notePath]);

  useEffect(() => {
    if (!editorRef.current || !note) return;
    // Path of the note THIS editor instance edits; captured in the effect's
    // closure so the cleanup flush below targets the right note even after
    // navigation has already advanced currentPathRef to the next note. (F7)
    const editedPath = note.path;

    const state = EditorState.create({
      doc: note.content,
      extensions: [
        markdown(),
        history(),
        keymap.of([
          ...defaultKeymap,
          ...historyKeymap,
          {
            key: "Mod-s",
            run: () => { saveNote(); return true; },
          },
        ]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
            saveTimerRef.current = setTimeout(saveNote, 2000);
          }
        }),
        embeddingOverlay(currentPathRef),
        EditorView.lineWrapping,
        EditorView.theme({
          "&": { height: "100%", backgroundColor: "var(--bg)" },
          ".cm-content": { color: "var(--text)", fontFamily: "inherit", padding: "1rem" },
          ".cm-gutters": { backgroundColor: "var(--surface)", borderRight: "1px solid var(--border)" },
          ".cm-cursor": { borderLeftColor: "var(--text)" },
          "&.cm-focused .cm-selectionBackground, ::selection": { backgroundColor: "#444" },
        }),
      ],
    });

    const view = new EditorView({ state, parent: editorRef.current });
    viewRef.current = view;

    return () => {
      // Flush (not just clear) a pending debounced save before tearing down
      // CodeMirror, so navigating away or opening the resolver never drops
      // up to ~2s of edits. Capture the doc text BEFORE view.destroy().
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
        const content = view.state.doc.toString();
        if (editedPath) {
          void api.notes.update(editedPath, { content }).then(() => {
            void useSyncStatus.getState().refreshLocal();
          }).catch(() => {});
        }
      }
      view.destroy();
    };
  }, [note?.path]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "s" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        saveNote();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [saveNote]);

  if (resolving && notePath) {
    return <ClashResolver path={notePath} onDone={() => setResolving(false)} />;
  }

  return (
    <div data-testid="editor" className="flex flex-col flex-1 h-full overflow-hidden">
      {isClash && (
        <div className="editor-clash-banner">
          ⚠ This note clashes with the hub.
          <button
            type="button"
            onClick={async () => {
              // Flush the pending debounced save so the resolver's "Yours"
              // side and the hub merge reflect the just-typed text, not a
              // stale on-disk copy (F7).
              if (saveTimerRef.current) {
                clearTimeout(saveTimerRef.current);
                saveTimerRef.current = null;
              }
              await saveNote();
              setResolving(true);
            }}
          >
            Resolve
          </button>
        </div>
      )}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        <div ref={editorRef} className="flex-1 h-full min-w-0" />
        {notePath && <NoteContextPanel path={notePath} />}
      </div>
    </div>
  );
}
