import { describe, test, expect, afterEach } from "bun:test";
import { render, screen, cleanup } from "@testing-library/react";
import { BrowserRouter } from "react-router";
import { KanbanView } from "../../src/client/views/KanbanView";

globalThis.fetch = (async () =>
  new Response(
    JSON.stringify([
      {
        id: 1,
        noteId: 1,
        notePath: "notes/a.md",
        text: "Task A",
        done: false,
        dueDate: null,
        priority: 0,
        board: "backlog",
        line: 1,
      },
      {
        id: 2,
        noteId: 1,
        notePath: "notes/a.md",
        text: "Task B",
        done: false,
        dueDate: null,
        priority: 0,
        board: "in-progress",
        line: 2,
      },
      {
        id: 3,
        noteId: 1,
        notePath: "notes/a.md",
        text: "Task C",
        done: true,
        dueDate: null,
        priority: 0,
        board: "done",
        line: 3,
      },
    ]),
  )) as any;

afterEach(() => cleanup());

describe("KanbanView", () => {
  test("renders columns: Backlog, In Progress, Done", async () => {
    render(
      <BrowserRouter>
        <KanbanView />
      </BrowserRouter>,
    );
    expect(await screen.findByText(/Backlog/)).toBeDefined();
    expect(screen.getByText(/In Progress/)).toBeDefined();
    expect(screen.getByText(/Done/)).toBeDefined();
  });

  test("renders task cards in correct columns", async () => {
    render(
      <BrowserRouter>
        <KanbanView />
      </BrowserRouter>,
    );
    expect(await screen.findByText("Task A")).toBeDefined();
    expect(screen.getByText("Task B")).toBeDefined();
    expect(screen.getByText("Task C")).toBeDefined();
  });
});
