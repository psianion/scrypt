// tests/client/app-shell.test.tsx
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { render, screen, fireEvent, within, cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { AppContent } from "../../src/client/App";
import { useStore } from "../../src/client/store";

// Mock fetch to return empty arrays for API calls. Saved/restored per-test so
// the full-suite run does not leak into unrelated test files.
const mockFetch = (async () =>
  new Response(JSON.stringify([]), { headers: { "Content-Type": "application/json" } })
) as any;

let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
  globalThis.fetch = mockFetch;
  useStore.setState({
    tabs: [],
    activeTab: null,
    notes: [],
    commandPaletteOpen: false,
    sidebarCollapsed: false,
  });
});

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
});

describe("App Shell", () => {
  test("renders sidebar with nav items", () => {
    render(<MemoryRouter initialEntries={["/"]}><AppContent /></MemoryRouter>);
    const sidebar = screen.getByTestId("sidebar");
    expect(within(sidebar).getByText("Notes")).toBeDefined();
    expect(within(sidebar).getByText("Journal")).toBeDefined();
    expect(within(sidebar).getByText("Tasks")).toBeDefined();
    expect(within(sidebar).getByText("Graph")).toBeDefined();
    expect(within(sidebar).getByText("Data")).toBeDefined();
  });

  test("clicking nav item routes to correct view", () => {
    render(<MemoryRouter initialEntries={["/"]}><AppContent /></MemoryRouter>);
    fireEvent.click(screen.getByText("Graph"));
    expect(screen.getByTestId("graph-view")).toBeDefined();
  });

  test("tab bar shows open files", () => {
    useStore.setState({
      tabs: [{ path: "notes/test.md", title: "Test" }],
      activeTab: "notes/test.md",
    });
    render(<MemoryRouter initialEntries={["/"]}><AppContent /></MemoryRouter>);
    expect(screen.getByText("Test")).toBeDefined();
  });

  test("Cmd+K opens command palette", () => {
    render(<MemoryRouter initialEntries={["/"]}><AppContent /></MemoryRouter>);
    fireEvent.keyDown(document, { key: "k", metaKey: true });
    expect(useStore.getState().commandPaletteOpen).toBe(true);
  });

  test("root route / redirects to /journal", async () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <AppContent />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getByText(/Today/i)).toBeDefined();
    });
  });

  test("sidebar highlights Journal when on /", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <AppContent />
      </MemoryRouter>,
    );
    const sidebar = screen.getByTestId("sidebar");
    const journalBtn = within(sidebar).getByText("Journal");
    expect(
      journalBtn.className.includes("bg-") ||
        journalBtn.getAttribute("aria-current") === "page",
    ).toBe(true);
  });
});
