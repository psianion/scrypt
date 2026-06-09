// src/client/views/JournalView.tsx
import { useEffect, useState, useCallback } from "react";
import { api, type JournalDay } from "../api";
import { JournalCalendar } from "../components/JournalCalendar";
import { ActivityStrip } from "../components/ActivityStrip";
import { useEmbeddingProgress } from "../stores/embeddingProgress";
import { todayKey, formatEntryDateTime } from "../../shared/date";

export function JournalView() {
  const [date, setDate] = useState(todayKey());
  const [day, setDay] = useState<JournalDay | null>(null);
  const [counts, setCounts] = useState<{ date: string; count: number }[]>([]);
  const [draft, setDraft] = useState("");
  const [todo, setTodo] = useState("");

  const hasActivity = useEmbeddingProgress(
    (s) => Object.keys(s.inFlight).length > 0,
  );

  const load = useCallback(async (d: string) => {
    const bundle = d === todayKey() ? await api.journal.today() : await api.journal.day(d);
    setDay(bundle);
  }, []);

  useEffect(() => {
    load(date).catch(() => setDay(null));
  }, [date, load]);

  useEffect(() => {
    const to = todayKey();
    const from = `${Number(to.slice(0, 4)) - 1}${to.slice(4)}`;
    api.journal.calendar(from, to).then(setCounts).catch(() => setCounts([]));
  }, [day]);

  async function saveEntry() {
    if (!draft.trim()) return;
    const updated = await api.journal.addEntry(date, draft);
    setDraft("");
    setDay(updated);
  }
  async function addTask() {
    if (!todo.trim()) return;
    await api.tasks.create({
      title: todo,
      type: "CUSTOM",
      due_date: date,
      note_path: `journal/${date}.md`,
      client_tag: `ui-${date}-${Date.now()}`,
    });
    setTodo("");
    load(date);
  }
  async function toggleTask(id: number, status: string) {
    await api.tasks.update(id, { status: status === "closed" ? "open" : "closed" });
    load(date);
  }

  const showAside = (day?.related?.length ?? 0) > 0 || hasActivity;

  return (
    <div data-testid="journal-view" className="flex h-full">
      <div className="flex flex-col flex-1 min-w-0 p-4 gap-4 overflow-y-auto">
        <JournalCalendar counts={counts} selected={date} onSelect={setDate} />
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="px-2 py-1 text-sm bg-[var(--surface)] border border-[var(--border)] rounded text-[var(--text)]"
          />
          <button
            onClick={() => setDate(todayKey())}
            className="px-3 py-1 text-sm bg-[var(--surface-hover)] text-[var(--text-muted)] rounded hover:text-[var(--text)]"
          >
            Today
          </button>
        </div>

        {/* Thoughts feed */}
        <section className="flex flex-col gap-3">
          {day?.entries.map((e) => (
            <article
              key={e.id}
              data-testid={`entry-${e.id}`}
              className="border-l-2 border-[var(--border)] pl-3"
            >
              <header
                className="text-xs text-[var(--text-muted)]"
                title={formatEntryDateTime(e.id)}
              >
                {e.displayTime}
              </header>
              <div className="whitespace-pre-wrap text-sm text-[var(--text)]">{e.body}</div>
            </article>
          ))}
          <div className="flex flex-col gap-2">
            <textarea
              data-testid="journal-composer"
              value={draft}
              onChange={(ev) => setDraft(ev.target.value)}
              placeholder="What are you thinking?"
              className="w-full p-2 text-sm bg-[var(--surface)] border border-[var(--border)] rounded text-[var(--text)]"
              rows={3}
            />
            <button
              data-testid="journal-composer-save"
              onClick={saveEntry}
              className="self-end px-3 py-1 text-sm bg-[var(--accent)] text-white rounded"
            >
              Save entry
            </button>
          </div>
        </section>

        {/* Tasks due today */}
        <section className="flex flex-col gap-2">
          <h3 className="text-xs uppercase text-[var(--text-muted)]">Today's tasks</h3>
          {day?.tasks_due.map((t) => (
            <label key={t.id} className="flex items-center gap-2 text-sm text-[var(--text)]">
              <input
                type="checkbox"
                checked={t.status === "closed"}
                onChange={() => toggleTask(t.id, t.status)}
              />
              <span
                className={
                  t.status === "closed" ? "line-through text-[var(--text-muted)]" : ""
                }
              >
                {t.title}
              </span>
            </label>
          ))}
          <div className="flex gap-2">
            <input
              data-testid="journal-todo"
              value={todo}
              onChange={(e) => setTodo(e.target.value)}
              placeholder="Add a task for today"
              className="flex-1 px-2 py-1 text-sm bg-[var(--surface)] border border-[var(--border)] rounded text-[var(--text)]"
            />
            <button
              onClick={addTask}
              className="px-3 py-1 text-sm bg-[var(--surface-hover)] text-[var(--text-muted)] rounded hover:text-[var(--text)]"
            >
              Add
            </button>
          </div>
        </section>
      </div>

      {/* Right rail — related notes (semantic) + ActivityStrip */}
      {showAside ? (
        <aside
          data-testid="journal-aside"
          className="w-[260px] border-l border-[var(--border-subtle)] flex flex-col overflow-hidden"
        >
          <div className="flex-1 min-h-0 overflow-y-auto p-3">
            {day && day.related.length > 0 ? (
              <div data-testid="journal-related">
                <div className="text-xs uppercase text-[var(--text-muted)] mb-2">
                  Related notes
                </div>
                {day.related.map((r) => (
                  <a
                    key={r.path}
                    href={`/notes/${r.path}`}
                    className="block text-sm py-1 text-[var(--text)] hover:underline"
                    title={r.score.toFixed(2)}
                  >
                    {r.title}
                  </a>
                ))}
              </div>
            ) : null}
          </div>
          <ActivityStrip />
        </aside>
      ) : null}
    </div>
  );
}
