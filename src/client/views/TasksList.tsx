import { useEffect, useState } from "react";
import { Link } from "react-router";
import { api } from "../api";
import type { Task } from "../../shared/types";

const TYPE_COLOR: Record<string, string> = {
  BRAINSTORM: "#6366f1",
  PLAN:       "#10b981",
  BUILD:      "#f59e0b",
  RESEARCH:   "#8b5cf6",
  REVIEW:     "#ef4444",
  CUSTOM:     "#64748b",
};

const STATUS_COLOR: Record<string, string> = {
  open:        "#94a3b8",
  in_progress: "#f59e0b",
  closed:      "#16a34a",
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
        <div>Loading…</div>
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
                <td><span className="pill" style={{ background: TYPE_COLOR[t.type] ?? "#64748b" }}>{t.type}</span></td>
                <td>{t.title}</td>
                <td><span className="pill" style={{ background: STATUS_COLOR[t.status] ?? "#64748b" }}>{t.status}</span></td>
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
