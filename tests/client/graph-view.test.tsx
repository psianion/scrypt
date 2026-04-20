import {
  describe,
  test,
  expect,
  beforeEach,
  afterEach,
  mock,
  spyOn,
} from "bun:test";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";

import type { GraphSnapshot } from "../../src/server/graph/snapshot";
import type { RenderHandle, RenderOpts } from "../../src/client/graph/render";
import { __resetSnapshotCache } from "../../src/client/graph/useGraphSnapshot";

// Spy ledger captured by the mocked renderer. One entry per createGraph call.
interface CreateCall {
  opts: RenderOpts;
  handle: RenderHandle & {
    updateFilterCalls: Array<RenderOpts["tierFilter"]>;
    updateQueryCalls: Array<{ visible: Set<string> | null; matches: Set<string> }>;
    focusCalls: string[];
    destroyed: boolean;
  };
}

const createCalls: CreateCall[] = [];

mock.module("../../src/client/graph/render", () => {
  return {
    createGraph(_parent: HTMLElement, opts: RenderOpts): RenderHandle {
      const fakeCanvas = document.createElement("canvas");
      const updateFilterCalls: Array<RenderOpts["tierFilter"]> = [];
      const updateQueryCalls: Array<{
        visible: Set<string> | null;
        matches: Set<string>;
      }> = [];
      const focusCalls: string[] = [];
      const handle = {
        canvas: fakeCanvas,
        destroy() {
          handle.destroyed = true;
        },
        focusNode(id: string) {
          focusCalls.push(id);
        },
        updateFilter(f: RenderOpts["tierFilter"]) {
          updateFilterCalls.push({ ...f });
        },
        updateQueryFilter(visible: Set<string> | null, matches: Set<string>) {
          updateQueryCalls.push({
            visible: visible ? new Set(visible) : null,
            matches: new Set(matches),
          });
        },
        destroyed: false,
        updateFilterCalls,
        updateQueryCalls,
        focusCalls,
      };
      createCalls.push({ opts, handle });
      return handle as unknown as RenderHandle;
    },
  };
});

// Imported AFTER mock.module so the GraphView module resolves the mocked renderer.
const { GraphView } = await import("../../src/client/views/GraphView");

const sampleSnap: GraphSnapshot = {
  generated_at: 1,
  nodes: [
    { id: "a.md", title: "Alpha", doc_type: null, project: "p", degree: 2, community: null },
    { id: "b.md", title: "Beta", doc_type: null, project: "p", degree: 1, community: null },
    { id: "c.md", title: "Gamma", doc_type: null, project: "p", degree: 1, community: null },
  ],
  edges: [
    { source: "a.md", target: "b.md", relation: "wikilink", confidence: "connected", reason: null },
    { source: "a.md", target: "c.md", relation: "mentions", confidence: "mentions", reason: null },
  ],
};

let originalFetch: typeof globalThis.fetch;
let warnSpy: ReturnType<typeof spyOn> | null = null;

function installFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  globalThis.fetch = ((url: any, init?: RequestInit) =>
    Promise.resolve(handler(String(url), init))) as any;
}

function renderAt(initialEntry = "/graph") {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/graph" element={<GraphView />} />
        <Route path="/note/*" element={<div data-testid="note-page" />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  originalFetch = globalThis.fetch;
  __resetSnapshotCache();
  createCalls.length = 0;
  localStorage.clear();
  warnSpy = spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  warnSpy?.mockRestore();
  warnSpy = null;
  globalThis.fetch = originalFetch;
});

describe("GraphView integration", () => {
  test("snapshot fetch wires full snapshot + global mode into renderer", async () => {
    installFetch(() =>
      new Response(JSON.stringify(sampleSnap), {
        status: 200,
        headers: { ETag: '"v1"', "Content-Type": "application/json" },
      }),
    );

    renderAt();
    await waitFor(() => expect(createCalls.length).toBeGreaterThan(0));

    const call = createCalls[0]!;
    expect(call.opts.mode).toEqual({ kind: "global" });
    expect(call.opts.snap.nodes.length).toBe(3);
    expect(call.opts.snap.edges.length).toBe(2);
    // tier filter defaults from tierFilter.ts (only `connected` on)
    expect(call.opts.tierFilter.connected).toBe(true);
    expect(call.opts.tierFilter.mentions).toBe(false);
  });

  test("tier toggle pushes new filter to renderer and persists v1 schema to localStorage", async () => {
    installFetch(() =>
      new Response(JSON.stringify(sampleSnap), {
        status: 200,
        headers: { ETag: '"v1"' },
      }),
    );

    renderAt();
    await waitFor(() => expect(createCalls.length).toBeGreaterThan(0));
    const call = createCalls[0]!;

    const mentionsCheckbox = screen.getByLabelText("mentions") as HTMLInputElement;
    expect(mentionsCheckbox.checked).toBe(false);
    fireEvent.click(mentionsCheckbox);

    await waitFor(() => expect(call.handle.updateFilterCalls.length).toBeGreaterThan(0));
    const last = call.handle.updateFilterCalls.at(-1)!;
    expect(last.mentions).toBe(true);
    expect(last.connected).toBe(true);

    const stored = JSON.parse(localStorage.getItem("graph-tier-filter") ?? "{}");
    expect(stored.version).toBe(1);
    expect(stored.mentions).toBe(true);
  });

  test("typing in search reaches renderer; failed search retains state and warns", async () => {
    let searchCalls = 0;
    installFetch((url) => {
      if (url.startsWith("/api/graph/snapshot")) {
        return new Response(JSON.stringify(sampleSnap), {
          status: 200,
          headers: { ETag: '"v1"' },
        });
      }
      if (url.startsWith("/api/search/graph")) {
        searchCalls++;
        if (searchCalls === 1) {
          return new Response(JSON.stringify({ paths: ["a.md"] }), { status: 200 });
        }
        // second call: server error → GraphView must catch and warn, not crash
        return new Response("nope", { status: 500 });
      }
      return new Response("[]");
    });

    renderAt();
    await waitFor(() => expect(createCalls.length).toBeGreaterThan(0));
    const call = createCalls[0]!;

    const search = screen.getByPlaceholderText("Search notes…") as HTMLInputElement;
    fireEvent.change(search, { target: { value: "alpha" } });

    await waitFor(
      () => {
        const ok = call.handle.updateQueryCalls.some((c) => c.matches.has("a.md"));
        expect(ok).toBe(true);
      },
      { timeout: 1500 },
    );

    const beforeFailureCalls = call.handle.updateQueryCalls.length;
    fireEvent.change(search, { target: { value: "beta" } });

    await waitFor(
      () => {
        expect(searchCalls).toBeGreaterThanOrEqual(2);
        expect(warnSpy!.mock.calls.length).toBeGreaterThan(0);
      },
      { timeout: 1500 },
    );

    // Renderer state from successful search is preserved (no extra
    // updateQueryFilter call for the failed request).
    expect(call.handle.updateQueryCalls.length).toBe(beforeFailureCalls);
  });

  test("snapshot fetch failure surfaces error UI and skips renderer", async () => {
    installFetch(() => new Response("boom", { status: 500 }));

    renderAt();
    await waitFor(() => {
      expect(screen.getByText(/failed to load graph/i)).toBeDefined();
    });
    expect(createCalls.length).toBe(0);
  });

  test("?focus=<path> calls focusNode after snapshot lands", async () => {
    installFetch(() =>
      new Response(JSON.stringify(sampleSnap), {
        status: 200,
        headers: { ETag: '"v1"' },
      }),
    );

    renderAt("/graph?focus=a.md");
    await waitFor(() => expect(createCalls.length).toBeGreaterThan(0));
    const call = createCalls[0]!;

    await waitFor(() => expect(call.handle.focusCalls).toContain("a.md"));
  });

  test("ETag round-trip — second snapshot fetch sends If-None-Match", async () => {
    let snapCalls = 0;
    const seenIfNoneMatch: Array<string | null> = [];
    installFetch((url, init) => {
      if (!url.startsWith("/api/graph/snapshot")) return new Response("[]");
      snapCalls++;
      const inm =
        (init?.headers && (init.headers as Record<string, string>)["If-None-Match"]) ?? null;
      seenIfNoneMatch.push(inm);
      if (snapCalls === 1) {
        return new Response(JSON.stringify(sampleSnap), {
          status: 200,
          headers: { ETag: '"v1"' },
        });
      }
      return new Response(null, { status: 304, headers: { ETag: '"v1"' } });
    });

    renderAt();
    await waitFor(() => expect(createCalls.length).toBeGreaterThan(0));

    // Force a second fetch via the module's exported helper — the hook normally
    // refetches on a tick, but we can drive it deterministically.
    const { fetchSnapshot } = await import("../../src/client/graph/useGraphSnapshot");
    await fetchSnapshot(true);

    expect(snapCalls).toBe(2);
    expect(seenIfNoneMatch[0]).toBeNull();
    expect(seenIfNoneMatch[1]).toBe('"v1"');
  });
});
