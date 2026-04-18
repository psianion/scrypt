import { test, expect, describe } from "bun:test";
import { buildSearchIndex, filterGraph } from "../../../src/client/graph/search";
import type { GraphSnapshot } from "../../../src/server/graph/snapshot";

const snap: GraphSnapshot = {
  generated_at: 0,
  nodes: [
    { id: "vtt.md", title: "VTT analysis", doc_type: "research", project: "x", degree: 2, community: 1 },
    { id: "spec.md", title: "VTT spec", doc_type: "spec", project: "x", degree: 2, community: 1 },
    { id: "other.md", title: "Something else", doc_type: "other", project: "x", degree: 0, community: 2 },
  ],
  edges: [{ source: "vtt.md", target: "spec.md", relation: "x", confidence: "connected", reason: null }],
};

describe("search", () => {
  test("empty query returns full graph", () => {
    const idx = buildSearchIndex(snap);
    const { nodes, edges } = filterGraph(snap, idx, "");
    expect(nodes).toHaveLength(3);
    expect(edges).toHaveLength(1);
  });

  test("matches title substring case-insensitively and includes 1-hop neighbours", () => {
    const idx = buildSearchIndex(snap);
    const { nodes } = filterGraph(snap, idx, "vtt analysis");
    const ids = nodes.map((n) => n.id).sort();
    expect(ids).toEqual(["spec.md", "vtt.md"]);
  });

  test("no match → empty nodes/edges", () => {
    const idx = buildSearchIndex(snap);
    const { nodes, edges } = filterGraph(snap, idx, "zzz");
    expect(nodes).toHaveLength(0);
    expect(edges).toHaveLength(0);
  });

  test("isMatch flag marks exact-hit nodes", () => {
    const idx = buildSearchIndex(snap);
    const { nodes } = filterGraph(snap, idx, "vtt analysis");
    const vtt = nodes.find((n) => n.id === "vtt.md")!;
    const spec = nodes.find((n) => n.id === "spec.md")!;
    expect(vtt.isMatch).toBe(true);
    expect(spec.isMatch).toBe(false);
  });
});
