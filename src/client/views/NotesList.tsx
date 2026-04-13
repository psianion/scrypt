import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { api } from "../api";
import type { NoteMeta } from "../../shared/types";

type SortKey = "modified" | "created" | "title";

export function NotesList() {
  const navigate = useNavigate();
  const [notes, setNotes] = useState<NoteMeta[]>([]);
  const [sort, setSort] = useState<SortKey>("modified");
  const [tagFilter, setTagFilter] = useState("");

  useEffect(() => {
    api.notes.list().then(setNotes).catch(() => setNotes([]));
  }, []);

  const filtered = useMemo(() => {
    let out = notes;
    if (tagFilter) {
      out = out.filter((n) =>
        n.tags.some((t) => t.toLowerCase().includes(tagFilter.toLowerCase())),
      );
    }
    out = [...out].sort((a, b) => {
      if (sort === "title") return a.title.localeCompare(b.title);
      const aVal = a[sort] || "";
      const bVal = b[sort] || "";
      return bVal.localeCompare(aVal);
    });
    return out;
  }, [notes, sort, tagFilter]);

  return (
    <div data-testid="notes-list" className="p-4 h-full overflow-auto">
      <div className="flex gap-3 items-center mb-4">
        <input
          placeholder="Filter by tag"
          value={tagFilter}
          onChange={(e) => setTagFilter(e.target.value)}
          className="px-2 py-1 text-sm bg-[var(--bg-secondary)] border border-[var(--border)] rounded text-[var(--text-primary)]"
        />
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          className="px-2 py-1 text-sm bg-[var(--bg-secondary)] border border-[var(--border)] rounded text-[var(--text-primary)]"
        >
          <option value="modified">Modified</option>
          <option value="created">Created</option>
          <option value="title">Title</option>
        </select>
        <span className="text-[var(--text-muted)] text-xs ml-auto">
          {filtered.length} notes
        </span>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[var(--text-muted)] uppercase text-xs">
            <th className="py-1">Title</th>
            <th className="py-1">Tags</th>
            <th className="py-1">Modified</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((n) => (
            <tr
              key={n.path}
              data-testid="note-row"
              onClick={() => navigate(`/note/${n.path}`)}
              className="border-t border-[var(--border)] hover:bg-[var(--bg-tertiary)] cursor-pointer"
            >
              <td className="py-1.5 text-[var(--text-primary)]">{n.title}</td>
              <td className="py-1.5 text-[var(--text-muted)]">
                {n.tags.map((t) => `#${t}`).join(" ")}
              </td>
              <td className="py-1.5 text-[var(--text-muted)]">
                {n.modified?.slice(0, 10)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
