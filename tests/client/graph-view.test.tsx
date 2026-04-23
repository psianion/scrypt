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
    { source: "a.md", target: "b.md", tier: "connected", reason: null },
    { source: "a.md", target: "c.md", tier: "mentions", reason: null },
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
      if (url.startsWith("/api/graph/search")) {
        searchCalls++;
        if (searchCalls === 1) {
          return new Response(
            JSON.stringify({
              hits: [
                {
                  path: "a.md",
                  title: "Alpha",
                  score: 0.5,
                  fts_rank: 1,
                  sem_rank: null,
                  hop_distance: null,
                },
              ],
            }),
            { status: 200 },
          );
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

  test("search box hits /api/graph/search with focus param + hits drive updateQueryFilter", async () => {
    const seenSearchUrls: string[] = [];
    installFetch((url) => {
      if (url.startsWith("/api/graph/snapshot")) {
        return new Response(JSON.stringify(sampleSnap), {
          status: 200,
          headers: { ETag: '"v1"' },
        });
      }
      if (url.startsWith("/api/graph/search")) {
        seenSearchUrls.push(url);
        return new Response(
          JSON.stringify({
            hits: [
              { path: "b.md", title: "Beta", score: 0.9, fts_rank: 1, sem_rank: 2, hop_distance: 1 },
              { path: "c.md", title: "Gamma", score: 0.4, fts_rank: 2, sem_rank: null, hop_distance: 2 },
              // hit not in snap — must be filtered out
              { path: "ghost.md", title: "Ghost", score: 0.3, fts_rank: 3, sem_rank: null, hop_distance: null },
            ],
          }),
          { status: 200 },
        );
      }
      return new Response("[]");
    });

    renderAt("/graph?focus=a.md");
    await waitFor(() => expect(createCalls.length).toBeGreaterThan(0));
    const call = createCalls[0]!;

    // ?focus= triggers a setQuery(node.title) — wait for that to flush a search.
    await waitFor(
      () => {
        expect(seenSearchUrls.length).toBeGreaterThan(0);
      },
      { timeout: 1500 },
    );

    const url = seenSearchUrls.at(-1)!;
    expect(url).toContain("/api/graph/search?");
    expect(url).toContain("q=");
    expect(url).toContain("focus=a.md");

    await waitFor(
      () => {
        const last = call.handle.updateQueryCalls.at(-1);
        if (!last) throw new Error("no update yet");
        expect(last.matches.has("b.md")).toBe(true);
        expect(last.matches.has("c.md")).toBe(true);
        expect(last.matches.has("ghost.md")).toBe(false);
      },
      { timeout: 1500 },
    );
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

// ─────────────────────────────────────────────────────────────────────────
// Presentational mode: <GraphView nodes={...} edges={...} />
//
// When nodes/edges are passed directly (no snapshot fetch, no router) the
// component renders an SVG DOM layer used for unit tests AND as the
// accessibility fallback. Spec §5.1 + §6.1.1.
// ─────────────────────────────────────────────────────────────────────────

describe("GraphView presentational (nodes/edges props)", () => {
  const longTitle =
    "A Very Long Title That Definitely Exceeds Forty Characters In Length";
  const presentationalNodes = [
    { id: "a", path: "projects/p/spec/a.md", title: longTitle, project: "p", doc_type: "spec" },
    { id: "b", path: "projects/p/research/b.md", title: "B", project: "p", doc_type: "research" },
    { id: "c", path: "projects/p/spec/c.md", title: "C", project: "p", doc_type: "spec" },
    { id: "d", path: "projects/p/spec/d.md", title: "D", project: "p", doc_type: "spec" },
  ];
  const presentationalEdges = [
    { source: "a", target: "b", tier: "connected" as const, reason: "derives-from" as const },
    { source: "c", target: "d", tier: "connected" as const, reason: "supersedes" as const },
    { source: "a", target: "c", tier: "semantically_related" as const, reason: null },
  ];

  test("graph node renders title truncated to ≤40 chars", () => {
    const { container } = render(
      <GraphView nodes={presentationalNodes} edges={[]} />,
    );
    const label = container.querySelector("[data-node-id='a'] .label")!;
    expect(label).toBeDefined();
    expect(label.textContent!.length).toBeLessThanOrEqual(40);
    expect(label.getAttribute("title")).toBe(longTitle);
  });

  test("graph edge with reason='derives-from' renders with blue solid stroke", () => {
    const { container } = render(
      <GraphView
        nodes={presentationalNodes}
        edges={presentationalEdges}
      />,
    );
    const edge = container.querySelector(
      "[data-edge-source='a'][data-edge-target='b']",
    ) as SVGElement;
    expect(edge).toBeDefined();
    expect(edge.getAttribute("stroke")).toBe("#3b82f6");
    expect(edge.getAttribute("stroke-dasharray")).toBeNull();
  });

  test("graph edge with reason='implements' renders with green stroke", () => {
    const nodes = [
      { id: "x", title: "X" },
      { id: "y", title: "Y" },
    ];
    const edges = [
      { source: "x", target: "y", tier: "connected" as const, reason: "implements" as const },
    ];
    const { container } = render(<GraphView nodes={nodes} edges={edges} />);
    const edge = container.querySelector(
      "[data-edge-source='x'][data-edge-target='y']",
    ) as SVGElement;
    expect(edge.getAttribute("stroke")).toBe("#10b981");
  });

  test("graph edge with reason='supersedes' greys out source node", () => {
    const { container } = render(
      <GraphView
        nodes={presentationalNodes}
        edges={presentationalEdges}
      />,
    );
    const sourceNode = container.querySelector(
      "[data-node-id='c']",
    ) as HTMLElement;
    expect(Number(sourceNode.getAttribute("data-opacity"))).toBeLessThan(1);
  });

  test("semantically_related edge renders dashed (stroke-dasharray set)", () => {
    const { container } = render(
      <GraphView
        nodes={presentationalNodes}
        edges={presentationalEdges}
      />,
    );
    const edge = container.querySelector(
      "[data-edge-source='a'][data-edge-target='c']",
    ) as SVGElement;
    expect(edge.getAttribute("stroke-dasharray")).toBeTruthy();
  });

  test("mentions edge renders solid grey with no arrow", () => {
    const nodes = [
      { id: "m1", title: "M1" },
      { id: "m2", title: "M2" },
    ];
    const edges = [
      { source: "m1", target: "m2", tier: "mentions" as const, reason: null },
    ];
    const { container } = render(<GraphView nodes={nodes} edges={edges} />);
    const edge = container.querySelector(
      "[data-edge-source='m1'][data-edge-target='m2']",
    ) as SVGElement;
    expect(edge.getAttribute("stroke")).toBe("#9aa0aa");
    expect(edge.getAttribute("stroke-dasharray")).toBeNull();
  });
});
