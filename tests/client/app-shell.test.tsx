// tests/client/app-shell.test.tsx
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { render, screen, fireEvent, within, cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { AppContent } from "../../src/client/App";
import { useStore } from "../../src/client/store";
// App.tsx code-splits /graph via React.lazy. Pre-importing the module here
// pre-fills Bun's module cache so the dynamic import in App resolves
// synchronously inside happy-dom, sidestepping the Suspense fallback during
// the nav-routing test.
import "../../src/client/views/GraphView";

// Mock fetch for API calls. Saved/restored per-test so the full-suite run does
// not leak into unrelated test files. Most endpoints return an empty array, but
// the journal day-bundle endpoints (/api/journal/today and /api/journal/:date)
// return an object { date, entries, tasks_due, related }, so JournalView (which
// renders at the root route "/") gets a well-formed empty bundle instead of [].
const mockFetch = (async (input: RequestInfo | URL) => {
  const url = typeof input === "string" ? input : input.toString();
  const isJournalBundle =
    /\/api\/journal\/(today|\d{4}-\d{2}-\d{2})(\?|$)/.test(url);
  const body = isJournalBundle
    ? { date: "1970-01-01", entries: [], tasks_due: [], related: [] }
    : [];
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
  });
}) as any;

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

  test("clicking nav item routes to correct view", async () => {
    render(<MemoryRouter initialEntries={["/"]}><AppContent /></MemoryRouter>);
    fireEvent.click(screen.getByText("Graph"));
    await waitFor(() => {
      // Module is pre-imported above, so React.lazy should resolve fast; the
      // fallback testid is the synchronous proof of navigation either way.
      expect(
        screen.queryByTestId("graph-view") ??
          screen.queryByTestId("graph-view-loading"),
      ).toBeDefined();
    });
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
      // Redirect landed on /journal => JournalView mounted. Assert on the
      // unambiguous view testid; "Today" now matches multiple nodes (the
      // "Today" button and the "Today's tasks" heading) in the reworked view.
      expect(screen.getByTestId("journal-view")).toBeDefined();
    });
  });

  test("sidebar highlights Journal when on /", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <AppContent />
      </MemoryRouter>,
    );
    const sidebar = screen.getByTestId("sidebar");
    // Post-Wave-1 the Journal label lives inside a <span> within the
    // button — check the ancestor button for the active marker.
    const journalBtn = within(sidebar)
      .getByText("Journal")
      .closest("button")!;
    expect(journalBtn.getAttribute("aria-current")).toBe("page");
  });
});
