// src/client/views/editor/embeddingOverlay.ts
//
// CodeMirror ViewPlugin that paints line-level decorations when the
// currently-open note has an embedding operation in flight. Reads from
// the shared Zustand progress store; redecorates on every store update.
import {
  ViewPlugin,
  Decoration,
  type DecorationSet,
  type EditorView,
  type PluginValue,
} from "@codemirror/view";
import { RangeSetBuilder, type Extension } from "@codemirror/state";
import {
  useEmbeddingProgress,
  type InFlightEntry,
} from "../../stores/embeddingProgress";

function buildDecorations(
  view: EditorView,
  entry: InFlightEntry | undefined,
): DecorationSet {
  if (!entry || !entry.activeRange) return Decoration.none;
  const [start, end] = entry.activeRange;
  const doc = view.state.doc;
  const builder = new RangeSetBuilder<Decoration>();
  const clampedEnd = Math.min(end, doc.lines - 1);
  for (let l = start; l <= clampedEnd; l++) {
    const lineNum = Math.min(Math.max(l + 1, 1), doc.lines);
    const line = doc.line(lineNum);
    builder.add(line.from, line.from, Decoration.line({ class: "embed-pulse" }));
  }
  return builder.finish();
}

export function embeddingOverlay(
  currentNotePathRef: { current: string | null },
): Extension {
  return ViewPlugin.fromClass(
    class EmbeddingOverlayPlugin implements PluginValue {
      decorations: DecorationSet = Decoration.none;
      private unsub: () => void;

      constructor(private view: EditorView) {
        this.unsub = useEmbeddingProgress.subscribe((s) => {
          const path = currentNotePathRef.current;
          const entry = path ? s.inFlight[path] : undefined;
          this.decorations = buildDecorations(this.view, entry);
          this.view.requestMeasure();
          // Force a redraw — ViewPlugin re-reads decorations on update.
          this.view.dispatch({});
        });
      }

      destroy() {
        this.unsub?.();
      }
    },
    { decorations: (v) => v.decorations },
  );
}
