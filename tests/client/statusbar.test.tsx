// tests/client/statusbar.test.tsx
//
// Wave 1 smoke test for the rewritten StatusBar.
// Asserts the three-slot layout, Breadcrumb wiring (left), filter Chip
// (middle), and brand pill + activity indicator (right). Visual fidelity
// against the pencil is verified by Playwright; this test pins the JSX
// contract.

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  render,
  screen,
  cleanup,
} from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { StatusBar } from "../../src/client/components/StatusBar";
import { useStore } from "../../src/client/store";
import { useEmbeddingProgress } from "../../src/client/stores/embeddingProgress";

beforeEach(() => {
  useStore.setState({ currentNote: null });
  useEmbeddingProgress.setState({ inFlight: {} });
});

afterEach(() => {
  cleanup();
  useStore.setState({ currentNote: null });
  useEmbeddingProgress.setState({ inFlight: {} });
});

function renderStatusBar() {
  return render(
    <MemoryRouter>
      <StatusBar />
    </MemoryRouter>,
  );
}

describe("StatusBar (Wave 1 rewrite)", () => {
  test("renders under the .status-bar token class with role=contentinfo", () => {
    renderStatusBar();
    const bar = screen.getByTestId("status-bar");
    expect(bar.classList.contains("status-bar")).toBe(true);
    expect(bar.getAttribute("role")).toBe("contentinfo");
  });

  test("empty state shows 'No file open' fallback when currentNote is null", () => {
    renderStatusBar();
    expect(screen.getByText("No file open")).toBeTruthy();
  });

  test("right slot always renders activity indicator, dot, and brand pill", () => {
    renderStatusBar();
    expect(screen.getByTestId("status-bar-activity").textContent).toContain(
      "idle",
    );
    expect(screen.getByTestId("status-bar-dot")).toBeTruthy();
    expect(screen.getByTestId("status-bar-brand").textContent).toBe("Scrypt");
  });

  test("breadcrumb renders one item per path segment when a note is open", () => {
    useStore.setState({
      currentNote: {
        path: "blog/post-2026",
        title: "Post 2026",
        body: "",
        meta: {},
        project: null,
        doc_type: null,
        thread: null,
      } as any,
    });
    renderStatusBar();
    const nav = screen.getByLabelText("Note location");
    expect(nav.textContent).toContain("blog");
    expect(nav.textContent).toContain("post-2026");
  });

  test("middle slot renders the project chip only when project is set", () => {
    // No project — chip absent.
    useStore.setState({
      currentNote: {
        path: "n1",
        title: "n1",
        body: "",
        meta: {},
      } as any,
    });
    renderStatusBar();
    expect(screen.queryByTestId("status-bar-project")).toBeNull();
    cleanup();

    // With project — chip present and labelled.
    useStore.setState({
      currentNote: {
        path: "n1",
        title: "n1",
        body: "",
        meta: {},
        project: "scrypt-revamp",
      } as any,
    });
    render(
      <MemoryRouter>
        <StatusBar />
      </MemoryRouter>,
    );
    const chip = screen.getByTestId("status-bar-project");
    expect(chip.textContent).toContain("scrypt-revamp");
  });

  test("activity indicator switches to 'indexing N' when embeddings are in flight", () => {
    useEmbeddingProgress.setState({
      inFlight: {
        "n1.md": {
          notePath: "n1.md",
          total: 4,
          storedCount: 1,
          startedAt: Date.now(),
        } as any,
      },
    });
    renderStatusBar();
    expect(screen.getByTestId("status-bar-activity").textContent).toContain(
      "indexing 1",
    );
  });
});
