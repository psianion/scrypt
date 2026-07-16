// src/server/journal/doc.ts
import { parseFrontmatter, stringifyFrontmatter } from "../parsers";
import { formatTime } from "../../shared/date";

export interface JournalEntry {
  /** Stable id = the entry's exact UTC ISO timestamp (also its `##` heading). */
  id: string;
  /** 12h display time derived from `id`, e.g. "3:00 PM". Not persisted. */
  displayTime: string;
  /** Free-form markdown body (trimmed). */
  body: string;
}

export interface JournalDoc {
  date: string; // YYYY-MM-DD
  frontmatter: Record<string, unknown>;
  entries: JournalEntry[];
}

const ENTRY_HEADING = /^##\s+(.+?)\s*$/;

export function parseJournalDoc(date: string, raw: string): JournalDoc {
  const { frontmatter, body } = parseFrontmatter(raw);
  const lines = body.split("\n");
  const entries: JournalEntry[] = [];

  let curIso: string | null = null;
  let buf: string[] = [];

  const flush = () => {
    if (curIso === null) return;
    entries.push({
      id: curIso,
      displayTime: formatTime(curIso),
      body: buf.join("\n").trim(),
    });
    buf = [];
  };

  for (const line of lines) {
    const m = line.match(ENTRY_HEADING);
    if (m) {
      flush();
      curIso = m[1];
    } else if (curIso !== null) {
      buf.push(line);
    }
  }
  flush();

  entries.sort((a, b) => a.id.localeCompare(b.id));
  return { date, frontmatter, entries };
}

export function serializeJournalDoc(doc: JournalDoc): string {
  const ordered = [...doc.entries].sort((a, b) => a.id.localeCompare(b.id));
  const blocks = ordered.map((e) => `## ${e.id}\n\n${e.body}\n`).join("\n");
  const body = `# ${doc.date}\n\n${blocks}`;
  return stringifyFrontmatter(doc.frontmatter, body);
}

/** `iso` is the entry's exact UTC timestamp (from `nowIso()` at write time). */
export function appendEntry(
  doc: JournalDoc,
  iso: string,
  body: string,
): JournalDoc {
  return {
    ...doc,
    entries: [
      ...doc.entries,
      { id: iso, displayTime: formatTime(iso), body: body.trim() },
    ].sort((a, b) => a.id.localeCompare(b.id)),
  };
}

export function editEntry(
  doc: JournalDoc,
  id: string,
  body: string,
): JournalDoc {
  const entries = doc.entries.map((e) =>
    e.id === id ? { ...e, body: body.trim() } : e,
  );
  return { ...doc, entries };
}

export function deleteEntry(doc: JournalDoc, id: string): JournalDoc {
  return { ...doc, entries: doc.entries.filter((e) => e.id !== id) };
}
