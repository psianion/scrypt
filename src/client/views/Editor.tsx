import { useEffect, useRef, useState, useCallback } from "react";
import { useLocation } from "react-router";
import { EditorView, keymap } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { useStore } from "../store";
import { api } from "../api";
import type { Note } from "../../shared/types";

export function Editor() {
  const location = useLocation();
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [note, setNote] = useState<(Note & { backlinks: any[] }) | null>(null);
  const setCurrentNote = useStore((s) => s.setCurrentNote);

  const notePath = location.pathname.replace("/note/", "");

  const saveNote = useCallback(async () => {
    if (!viewRef.current || !notePath) return;
    const content = viewRef.current.state.doc.toString();
    await api.notes.update(notePath, { content });
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
        EditorView.theme({
          "&": { height: "100%", backgroundColor: "var(--bg-primary)" },
          ".cm-content": { color: "var(--text-primary)", fontFamily: "inherit", padding: "1rem" },
          ".cm-gutters": { backgroundColor: "var(--bg-secondary)", borderRight: "1px solid var(--border)" },
          ".cm-cursor": { borderLeftColor: "var(--text-primary)" },
          "&.cm-focused .cm-selectionBackground, ::selection": { backgroundColor: "#444" },
        }),
      ],
    });

    const view = new EditorView({ state, parent: editorRef.current });
    viewRef.current = view;

    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
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

  return (
    <div data-testid="editor" className="flex-1 h-full overflow-hidden">
      <div ref={editorRef} className="h-full" />
    </div>
  );
}
