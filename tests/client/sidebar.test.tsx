// tests/client/sidebar.test.tsx
//
// Wave 1 smoke test for the rewritten Sidebar.
// Complements tests/client/app-shell.test.tsx (which already validates the
// sidebar's nav-item labels in the full app shell). These tests focus on the
// Wave 1-specific bits: lucide-rendered icons, token-class migration, and
// the new tree-area ContextMenu wiring.

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  render,
  screen,
  fireEvent,
  within,
  cleanup,
} from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { Sidebar } from "../../src/client/components/Sidebar";
import { useStore } from "../../src/client/store";

// API list endpoint — Sidebar fires api.notes.list() on mount. Stub so the
// test never makes a real network request.
const mockFetch = (async () =>
  new Response(JSON.stringify([]), {
    headers: { "Content-Type": "application/json" },
  })) as unknown as typeof fetch;

let originalFetch: typeof fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
  globalThis.fetch = mockFetch;
  useStore.setState({
    notes: [],
    sidebarCollapsed: false,
  });
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
});

function renderSidebar(path = "/journal") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Sidebar />
    </MemoryRouter>,
  );
}

describe("Sidebar (Wave 1 rewrite)", () => {
  test("renders under the .sidebar token class (no tailwind chrome)", () => {
    renderSidebar();
    const sidebar = screen.getByTestId("sidebar");
    expect(sidebar.classList.contains("sidebar")).toBe(true);
    expect(sidebar.classList.contains("sidebar--collapsed")).toBe(false);
  });

  test("each nav item is a token-class button with a lucide svg icon", () => {
    renderSidebar();
    const sidebar = screen.getByTestId("sidebar");
    for (const label of [
      "Journal",
      "Notes",
      "Tasks",
      "Search",
      "Graph",
      "Data",
      "Tags",
      "Settings",
    ]) {
      const btn = within(sidebar).getByText(label).closest("button");
      expect(btn).not.toBeNull();
      expect(btn!.classList.contains("sidebar-item")).toBe(true);
      expect(btn!.querySelector("svg")).not.toBeNull();
    }
  });

  test("active nav item sets data-active and aria-current", () => {
    renderSidebar("/graph");
    const graphBtn = screen.getByText("Graph").closest("button");
    expect(graphBtn?.getAttribute("data-active")).toBe("");
    expect(graphBtn?.getAttribute("aria-current")).toBe("page");
  });

  test("root '/' path marks Journal as active (alias)", () => {
    renderSidebar("/");
    const journalBtn = screen.getByText("Journal").closest("button");
    expect(journalBtn?.getAttribute("aria-current")).toBe("page");
  });

  test("renders the New note row only when onNewNote is provided", () => {
    const { rerender } = render(
      <MemoryRouter initialEntries={["/journal"]}>
        <Sidebar />
      </MemoryRouter>,
    );
    expect(screen.queryByText("New note")).toBeNull();
    rerender(
      <MemoryRouter initialEntries={["/journal"]}>
        <Sidebar onNewNote={() => {}} />
      </MemoryRouter>,
    );
    expect(screen.getByText("New note")).toBeTruthy();
  });

  test("right-clicking the folder-tree area opens a ContextMenu", () => {
    renderSidebar();
    const tree = screen.getByTestId("sidebar-tree");

    // Before right-click: no menu in body.
    expect(document.querySelector("[role='menu']")).toBeNull();

    fireEvent.contextMenu(tree, { clientX: 50, clientY: 50 });

    const menu = document.querySelector("[role='menu']");
    expect(menu).not.toBeNull();
    expect(menu!.textContent).toContain("Refresh");
    expect(menu!.textContent).toContain("Collapse all");
  });

  test("collapsed state renders the empty collapsed rail", () => {
    useStore.setState({ sidebarCollapsed: true });
    renderSidebar();
    const sidebar = screen.getByTestId("sidebar");
    expect(sidebar.classList.contains("sidebar--collapsed")).toBe(true);
    expect(within(sidebar).queryByText("Journal")).toBeNull();
  });
});
