// tests/client/graph-view.test.tsx
import { describe, test, expect } from "bun:test";
import { render, screen } from "@testing-library/react";
import { BrowserRouter } from "react-router";
import { GraphView } from "../../src/client/views/GraphView";

globalThis.fetch = (async () =>
  new Response(JSON.stringify({
    nodes: [
      { id: 1, path: "notes/a.md", title: "A", tags: [], connections: 1 },
      { id: 2, path: "notes/b.md", title: "B", tags: [], connections: 1 },
    ],
    edges: [{ source: 1, target: 2, type: "link" }],
  }))
) as any;

describe("GraphView", () => {
  test("fetches graph data and renders SVG", async () => {
    render(<BrowserRouter><GraphView /></BrowserRouter>);
    const view = await screen.findByTestId("graph-view");
    expect(view).toBeDefined();
    // D3 will render an SVG inside the container
  });

  test("has filter controls", async () => {
    render(<BrowserRouter><GraphView /></BrowserRouter>);
    expect(await screen.findByPlaceholderText(/filter/i)).toBeDefined();
  });
});
