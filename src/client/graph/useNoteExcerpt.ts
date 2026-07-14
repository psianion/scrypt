// Debounced, cached note-excerpt fetcher shared by NodeDetailCard and
// NodeTooltip. Cache is module-scoped (not per-hook-instance) so hovering a
// node and then selecting it doesn't re-fetch.
import { useEffect, useState } from "react";
import { api } from "../api";

const cache = new Map<string, string>(); // path -> excerpt (possibly "")
const DEBOUNCE_MS = 150;

/** First non-empty markdown paragraph, heading markers/emphasis stripped, capped to ~160 chars. */
export function firstParagraph(content: string): string {
  const paragraphs = content.split(/\n\s*\n/);
  for (const raw of paragraphs) {
    const line = raw
      .trim()
      .replace(/^#+\s*/, "")
      .replace(/[*_`]/g, "")
      .trim();
    if (line) return line.length > 160 ? `${line.slice(0, 157)}…` : line;
  }
  return "";
}

/** Returns the excerpt for `path` ("" while loading/empty), debounced + cached. */
export function useNoteExcerpt(path: string | null): string {
  const [excerpt, setExcerpt] = useState(() => (path ? cache.get(path) ?? "" : ""));

  useEffect(() => {
    if (!path) {
      setExcerpt("");
      return;
    }
    const cached = cache.get(path);
    if (cached !== undefined) {
      setExcerpt(cached);
      return;
    }
    setExcerpt("");
    let cancelled = false;
    const timer = setTimeout(() => {
      api.notes
        .get(path)
        .then((note) => {
          if (cancelled) return;
          const text = firstParagraph(note.content ?? "");
          cache.set(path, text);
          setExcerpt(text);
        })
        .catch(() => {
          if (cancelled) return;
          cache.set(path, "");
          setExcerpt("");
        });
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [path]);

  return excerpt;
}
