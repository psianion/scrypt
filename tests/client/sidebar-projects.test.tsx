// tests/client/sidebar-projects.test.tsx
//
// Wave 1 smoke for the project-chip row sourcing from top-level vault folders.
// Asserts:
//  • topLevelProjects() returns sorted unique top-level dir names from notes,
//    handling both ingest-v3 (`projects/<p>/...`) and legacy (`<top>/...`)
//    layouts and dropping reserved folders.
//  • Sidebar renders one chip per top-level project; click toggles the chip's
//    data-active state and is reflected via the FolderTree filter.

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  render,
  screen,
  fireEvent,
  cleanup,
} from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { Sidebar } from "../../src/client/components/Sidebar";
import { topLevelProjects } from "../../src/client/components/FolderTree.helpers";
import { useStore } from "../../src/client/store";

const stubFetch = (async () =>
  new Response(JSON.stringify([]), {
    headers: { "Content-Type": "application/json" },
  })) as unknown as typeof fetch;

let originalFetch: typeof fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
  globalThis.fetch = stubFetch;
  useStore.setState({
    notes: [
      // Two ingest-v3 projects + one legacy top-level + a reserved folder
      // that must be dropped.
      { path: "projects/scrypt/spec/x.md", title: "x", project: "scrypt", doc_type: "spec" } as any,
      { path: "projects/scrypt/plan/y.md", title: "y", project: "scrypt", doc_type: "plan" } as any,
      { path: "projects/dnd/research/z.md", title: "z", project: "dnd", doc_type: "research" } as any,
      { path: "longrest/inbox/a.md", title: "a" } as any,
      { path: "journal/2026/04/25.md", title: "j" } as any, // reserved
      { path: "data/sheets/b.csv", title: "b" } as any,    // reserved
    ],
    sidebarCollapsed: false,
  });
});

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
  useStore.setState({ notes: [] });
});

describe("topLevelProjects helper", () => {
  test("merges ingest-v3 + legacy layouts, drops reserved, sorts alphabetically", () => {
    const list = topLevelProjects(useStore.getState().notes as any);
    expect(list).toEqual(["dnd", "longrest", "scrypt"]);
  });

  test("pins _inbox to the top when present", () => {
    const notes = [
      { path: "projects/scrypt/spec/x.md" },
      { path: "projects/_inbox/spec/y.md" },
      { path: "projects/dnd/research/z.md" },
    ] as any;
    expect(topLevelProjects(notes)).toEqual(["_inbox", "dnd", "scrypt"]);
  });
});

describe("Sidebar project chip row", () => {
  function renderSidebar() {
    return render(
      <MemoryRouter initialEntries={["/journal"]}>
        <Sidebar />
      </MemoryRouter>,
    );
  }

  test("renders a chip per top-level project, mono-styled", () => {
    renderSidebar();
    const wrap = screen.getByTestId("sidebar-projects");
    const chips = wrap.querySelectorAll(".sidebar-project-chip");
    const labels = [...chips].map((c) => c.textContent);
    expect(labels).toEqual(["dnd", "longrest", "scrypt"]);
    // Each chip is a real <button> with role=tab + aria-selected.
    expect(chips[0].tagName).toBe("BUTTON");
    expect(chips[0].getAttribute("role")).toBe("tab");
    expect(chips[0].getAttribute("aria-selected")).toBe("false");
  });

  test("clicking a chip toggles data-active and aria-selected", () => {
    renderSidebar();
    const dnd = screen.getByTestId("sidebar-project-dnd");
    expect(dnd.hasAttribute("data-active")).toBe(false);
    fireEvent.click(dnd);
    expect(dnd.hasAttribute("data-active")).toBe(true);
    expect(dnd.getAttribute("aria-selected")).toBe("true");
    // Click again deselects.
    fireEvent.click(dnd);
    expect(dnd.hasAttribute("data-active")).toBe(false);
  });

  test("does not render the chip row when no projects are derivable", () => {
    useStore.setState({ notes: [] });
    renderSidebar();
    expect(screen.queryByTestId("sidebar-projects")).toBeNull();
  });
});
