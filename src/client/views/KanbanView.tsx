import { useEffect } from "react";
import { useNavigate } from "react-router";
import { DndContext, closestCenter, type DragEndEvent } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { api } from "../api";
import { useStore } from "../store";
import type { Task } from "../../shared/types";

const COLUMNS = [
  { id: "backlog", label: "Backlog" },
  { id: "in-progress", label: "In Progress" },
  { id: "done", label: "Done" },
];

function TaskCard({ task }: { task: Task }) {
  const navigate = useNavigate();
  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({ id: task.id });
  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className="p-2 mb-1 rounded bg-[var(--bg-tertiary)] text-sm cursor-grab active:cursor-grabbing"
    >
      <div className="text-[var(--text-primary)]">{task.text}</div>
      <button
        onClick={() => navigate(`/note/${task.notePath}`)}
        className="text-xs text-[var(--text-muted)] hover:underline mt-0.5"
      >
        {task.notePath.split("/").pop()?.replace(".md", "")}
      </button>
    </div>
  );
}

export function KanbanView() {
  const tasks = useStore((s) => s.tasks);
  const setTasks = useStore((s) => s.setTasks);

  useEffect(() => {
    api.tasks.list().then(setTasks).catch(() => {});
  }, [setTasks]);

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over) return;

    const taskId = active.id as number;
    const targetColumn = COLUMNS.find(
      (c) =>
        tasks.filter((t) => t.board === c.id).some((t) => t.id === over.id) ||
        over.id === c.id,
    );
    if (!targetColumn) return;

    await api.tasks.update(taskId, { board: targetColumn.id });
    setTasks(
      tasks.map((t) =>
        t.id === taskId ? { ...t, board: targetColumn.id } : t,
      ),
    );
  }

  return (
    <div
      data-testid="kanban-view"
      className="flex h-full p-4 gap-4 overflow-x-auto"
    >
      <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        {COLUMNS.map((col) => {
          const colTasks = tasks.filter((t) => t.board === col.id);
          return (
            <div key={col.id} className="flex flex-col w-64 flex-shrink-0">
              <div className="text-xs uppercase tracking-wide text-[var(--text-muted)] mb-2">
                {col.label} ({colTasks.length})
              </div>
              <div className="flex-1 bg-[var(--bg-secondary)] rounded p-2 overflow-y-auto">
                <SortableContext
                  items={colTasks.map((t) => t.id)}
                  strategy={verticalListSortingStrategy}
                >
                  {colTasks.map((task) => (
                    <TaskCard key={task.id} task={task} />
                  ))}
                </SortableContext>
              </div>
            </div>
          );
        })}
      </DndContext>
    </div>
  );
}
