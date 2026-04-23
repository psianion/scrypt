import { describe, test, expect, afterEach, beforeEach } from "bun:test";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
} from "@testing-library/react";
import { BrowserRouter } from "react-router";
import { SearchView } from "../../src/client/views/SearchView";

afterEach(() => cleanup());

interface RecordedCall {
  url: string;
  method: string;
}

function installFetch(
  calls: RecordedCall[],
  hits: Array<{
    path: string;
    title: string;
    score?: number;
    fts_rank?: number | null;
    sem_rank?: number | null;
    hop_distance?: number | null;
  }>,
) {
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), method: init?.method ?? "GET" });
    return new Response(JSON.stringify({ hits }), { status: 200 });
  }) as typeof fetch;
}

describe("SearchView", () => {
  beforeEach(() => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ hits: [] }))) as any;
  });

  test("renders a search input", () => {
    render(
      <BrowserRouter>
        <SearchView />
      </BrowserRouter>,
    );
    expect(screen.getByRole("searchbox")).toBeDefined();
  });

  test("search result row shows title (primary) + slug (secondary) + path (breadcrumb)", async () => {
    const calls: RecordedCall[] = [];
    installFetch(calls, [
      {
        path: "projects/dbtmg/plan/multi-image-upload.md",
        title: "Multi-Image Upload Plan",
      },
    ]);
    render(
      <BrowserRouter>
        <SearchView />
      </BrowserRouter>,
    );
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "multi" },
    });
    const titleEl = await screen.findByText("Multi-Image Upload Plan");
    const row = titleEl.closest("[data-result-row]")!;
    expect(row).toBeDefined();
    expect(row.querySelector("[data-slug]")?.textContent).toBe(
      "multi-image-upload",
    );
    expect(row.querySelector("[data-path]")?.textContent).toContain(
      "projects/dbtmg/plan/multi-image-upload.md",
    );
  });

  test("fires /api/graph/search with project/doc_type filters when chips active", async () => {
    const calls: RecordedCall[] = [];
    installFetch(calls, []);
    render(
      <BrowserRouter>
        <SearchView defaultFilters={{ project: "dbtmg", doc_type: "plan" }} />
      </BrowserRouter>,
    );
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "q" },
    });
    await waitFor(() =>
      expect(
        calls.some(
          (c) =>
            c.url.includes("/api/graph/search") &&
            c.url.includes("project=dbtmg") &&
            c.url.includes("doc_type=plan"),
        ),
      ).toBe(true),
    );
  });

  test("clearing a filter chip removes its query param from the next request", async () => {
    const calls: RecordedCall[] = [];
    installFetch(calls, []);
    render(
      <BrowserRouter>
        <SearchView defaultFilters={{ project: "dbtmg" }} />
      </BrowserRouter>,
    );
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "q" },
    });
    await waitFor(() =>
      expect(calls.some((c) => c.url.includes("project=dbtmg"))).toBe(true),
    );
    const beforeClearCount = calls.length;
    fireEvent.click(screen.getByRole("button", { name: /dbtmg/i }));
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "q2" },
    });
    await waitFor(() => expect(calls.length).toBeGreaterThan(beforeClearCount));
    const lastCall = calls[calls.length - 1]!;
    expect(lastCall.url).not.toContain("project=dbtmg");
  });

  test("empty query does not fire a request", async () => {
    const calls: RecordedCall[] = [];
    installFetch(calls, []);
    render(
      <BrowserRouter>
        <SearchView />
      </BrowserRouter>,
    );
    // No typing — no debounce fires — no network.
    expect(calls.length).toBe(0);
  });
});
