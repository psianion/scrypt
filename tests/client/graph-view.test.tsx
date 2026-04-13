import { describe, test, expect, afterEach, beforeEach } from "bun:test";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { BrowserRouter } from "react-router";
import { GraphView } from "../../src/client/views/GraphView";

const fixture = {
  nodes: [
    { id: 1, path: "dnd/research/a.md", title: "A", domain: "dnd", subdomain: "research", tags: [{ namespace: "type", value: "research", raw: "type:research" }], connectionCount: 2 },
    { id: 2, path: "dnd/research/b.md", title: "B", domain: "dnd", subdomain: "research", tags: [{ namespace: "type", value: "research", raw: "type:research" }], connectionCount: 2 },
    { id: 3, path: "dnd/plans/c.md", title: "C", domain: "dnd", subdomain: "plans", tags: [], connectionCount: 1 },
  ],
  edges: [
    { source: 1, target: 2, type: "subdomain", weight: 2 },
    { source: 1, target: 3, type: "domain", weight: 1 },
    { source: 1, target: 2, type: "tag", weight: 1.5 },
  ],
};

let originalFetch: typeof globalThis.fetch;
const mockFetch = (async (url: string) => {
  if (url.startsWith("/api/graph")) {
    return new Response(JSON.stringify(fixture));
  }
  return new Response("[]");
}) as any;

beforeEach(() => {
  originalFetch = globalThis.fetch;
  globalThis.fetch = mockFetch;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  cleanup();
});

describe("GraphView", () => {
  test("renders one circle per node", async () => {
    render(
      <BrowserRouter>
        <GraphView />
      </BrowserRouter>,
    );
    await new Promise((r) => setTimeout(r, 50));
    const circles = document.querySelectorAll(
      "svg [data-testid='graph-node']",
    );
    expect(circles.length).toBe(3);
  });

  test("renders edges with type-specific class", async () => {
    render(
      <BrowserRouter>
        <GraphView />
      </BrowserRouter>,
    );
    await new Promise((r) => setTimeout(r, 50));
    const subdomainLines = document.querySelectorAll("line[data-edge-type='subdomain']");
    const domainLines = document.querySelectorAll("line[data-edge-type='domain']");
    const tagLines = document.querySelectorAll("line[data-edge-type='tag']");
    expect(subdomainLines.length).toBe(1);
    expect(domainLines.length).toBe(1);
    expect(tagLines.length).toBe(1);
  });
});

describe("GraphView interactions", () => {
  test("hovering a node fades non-neighbors", async () => {
    render(
      <BrowserRouter>
        <GraphView />
      </BrowserRouter>,
    );
    await new Promise((r) => setTimeout(r, 50));
    const nodes = document.querySelectorAll("circle[data-testid='graph-node']") as NodeListOf<SVGCircleElement>;
    expect(nodes.length).toBe(3);
    fireEvent.mouseEnter(nodes[0]);
    expect(nodes[0].getAttribute("opacity")).not.toBe("0.2");
  });

  test("scrolling the SVG updates the root transform (zoom)", async () => {
    render(
      <BrowserRouter>
        <GraphView />
      </BrowserRouter>,
    );
    await new Promise((r) => setTimeout(r, 50));
    const svg = document.querySelector("svg") as SVGSVGElement;
    fireEvent.wheel(svg, { deltaY: -100, clientX: 400, clientY: 300 });
    const rootG = svg.querySelector("g.root") as SVGGElement;
    expect(rootG.getAttribute("transform")).toMatch(/scale\(/);
  });
});
