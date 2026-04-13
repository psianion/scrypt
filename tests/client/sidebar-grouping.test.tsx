import { describe, test, expect, afterEach, beforeEach } from "bun:test";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { AppContent } from "../../src/client/App";
import { useStore } from "../../src/client/store";

globalThis.fetch = (async () =>
  new Response(JSON.stringify([]), {
    headers: { "Content-Type": "application/json" },
  })) as any;

beforeEach(() => {
  useStore.setState({
    notes: [
      {
        path: "notes/threads/open-thing.md",
        title: "Open Thing",
        tags: [],
        modified: "2026-04-12T10:00:00Z",
        created: "2026-04-10T10:00:00Z",
        aliases: [],
      },
      {
        path: "notes/research/2026-04-12-0314-run.md",
        title: "Run Note",
        tags: [],
        modified: "2026-04-12T11:00:00Z",
        created: "2026-04-12T11:00:00Z",
        aliases: [],
      },
      {
        path: "memory/3d-printing.md",
        title: "3D Printing",
        tags: [],
        modified: "2026-04-10T10:00:00Z",
        created: "2026-04-10T10:00:00Z",
        aliases: [],
      },
      {
        path: "notes/inbox/random.md",
        title: "Random",
        tags: [],
        modified: "2026-04-10T10:00:00Z",
        created: "2026-04-10T10:00:00Z",
        aliases: [],
      },
    ],
    tabs: [],
    activeTab: null,
    commandPaletteOpen: false,
    sidebarCollapsed: false,
  });
});
afterEach(() => cleanup());

describe("Sidebar grouping", () => {
  test("shows collapsible section headers", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <AppContent />
      </MemoryRouter>,
    );
    expect(screen.getByText(/THREADS/i)).toBeDefined();
    expect(screen.getByText(/RESEARCH/i)).toBeDefined();
    expect(screen.getByText(/MEMORY/i)).toBeDefined();
    expect(screen.getByText(/INBOX/i)).toBeDefined();
  });

  test("does not show empty sections", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <AppContent />
      </MemoryRouter>,
    );
    expect(screen.queryByText(/LOGS/i)).toBeNull();
  });

  test("files appear under their section", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <AppContent />
      </MemoryRouter>,
    );
    expect(screen.getByText("Open Thing")).toBeDefined();
    expect(screen.getByText("Run Note")).toBeDefined();
    expect(screen.getByText("3D Printing")).toBeDefined();
  });
});
