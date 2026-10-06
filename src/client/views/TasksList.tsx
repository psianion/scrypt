import { useEffect, useState } from "react";
import { Link } from "react-router";
import { api } from "../api";
import { Chip, type ChipVariant } from "../ui/Chip";
import type { Task } from "../../shared/types";
import "./TasksList.css";

const STATUS_VARIANT: Record<string, ChipVariant> = {
  open:        "default",
  in_progress: "status-review",
  closed:      "status-done",
};

export function TasksList() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [total, setTotal] = useState(0);
  const [showClosed, setShowClosed] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.tasks
      .list({ status: showClosed ? "all" : "open" })
      .then((r) => { setTasks(r.tasks); setTotal(r.total); })
      .finally(() => setLoading(false));
  }, [showClosed]);

  return (
    <div className="tasks-list">
      <header className="tasks-list__header">
        <h1>Tasks</h1>
        <label>
          <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} />
          Show closed
        </label>
        <span className="tasks-list__count">{total}</span>
      </header>
      {loading ? (
        <div className="tasks-list__empty">Loading…</div>
      ) : tasks.length === 0 ? (
        <div className="tasks-list__empty">No tasks.</div>
      ) : (
        <table className="tasks-list__table">
          <thead>
            <tr>
              <th>Type</th><th>Title</th><th>Status</th><th>Note</th><th>Due</th><th>Priority</th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((t) => (
              <tr key={t.id}>
                <td><Chip>{t.type}</Chip></td>
                <td>{t.title}</td>
                <td><Chip variant={STATUS_VARIANT[t.status] ?? "default"}>{t.status}</Chip></td>
                <td>{t.note_path ? <Link to={`/note/${t.note_path}`}>{t.note_path}</Link> : "—"}</td>
                <td>{t.due_date ?? "—"}</td>
                <td>{t.priority ?? 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
