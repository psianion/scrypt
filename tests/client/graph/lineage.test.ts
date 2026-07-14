import { test, expect, describe } from "bun:test";
import {
  isLineageEdge,
  prerequisiteClosure,
  directPrerequisites,
  directDependents,
  lineageDepth,
  displayLevel,
} from "../../../src/client/graph/lineage";
import type { SnapshotEdge } from "../../../src/server/graph/snapshot";

function edge(source: string, target: string, reason: string | null, tier: SnapshotEdge["tier"] = "connected"): SnapshotEdge {
  return { source, target, tier, reason, rel_type: null };
}

// Chain: plan -> spec -> research (plan derives from spec, spec derives from
// research). Plus an unrelated `mentions` edge and a same-project sibling
// `implements` edge that should NOT be pulled in as an ancestor of `spec`.
const chain: SnapshotEdge[] = [
  edge("plan.md", "spec.md", "implements"),
  edge("spec.md", "research.md", "derives-from"),
  edge("spec.md", "sibling.md", "mentions", "mentions"), // non-lineage, ignored
];

describe("lineage direction helpers", () => {
  test("isLineageEdge accepts only connected-tier lineage reasons", () => {
    expect(isLineageEdge(edge("a", "b", "derives-from"))).toBe(true);
    expect(isLineageEdge(edge("a", "b", "implements"))).toBe(true);
    expect(isLineageEdge(edge("a", "b", "supersedes"))).toBe(true);
    expect(isLineageEdge(edge("a", "b", null))).toBe(false);
    expect(isLineageEdge(edge("a", "b", "derives-from", "mentions"))).toBe(false);
  });

  test("prerequisiteClosure follows source->target transitively, excludes self", () => {
    const closure = prerequisiteClosure("plan.md", chain);
    expect(closure.has("spec.md")).toBe(true);
    expect(closure.has("research.md")).toBe(true);
    expect(closure.has("plan.md")).toBe(false);
    expect(closure.has("sibling.md")).toBe(false); // non-lineage edge not followed
    expect(closure.size).toBe(2);
  });

  test("prerequisiteClosure of a root node (no outgoing lineage edges) is empty", () => {
    expect(prerequisiteClosure("research.md", chain).size).toBe(0);
  });

  test("prerequisiteClosure is cycle-safe", () => {
    const cyclic: SnapshotEdge[] = [
      edge("a.md", "b.md", "derives-from"),
      edge("b.md", "c.md", "derives-from"),
      edge("c.md", "a.md", "derives-from"), // cycle back to start
    ];
    const closure = prerequisiteClosure("a.md", cyclic);
    expect(closure).toEqual(new Set(["b.md", "c.md"]));
  });

  test("directPrerequisites returns only immediate targets", () => {
    expect(directPrerequisites("plan.md", chain)).toEqual(["spec.md"]);
    expect(directPrerequisites("spec.md", chain)).toEqual(["research.md"]);
    expect(directPrerequisites("research.md", chain)).toEqual([]);
  });

  test("directDependents returns immediate sources that depend on the node", () => {
    expect(directDependents("spec.md", chain)).toEqual(["plan.md"]);
    expect(directDependents("research.md", chain)).toEqual(["spec.md"]);
    expect(directDependents("plan.md", chain)).toEqual([]);
  });

  test("lineageDepth counts hops along source->target lineage edges (0 = nothing depends on the source of the chain)", () => {
    // plan -[implements]-> spec -[derives-from]-> research: depth grows in
    // the source->target direction, so the most-foundational node
    // (research, the thing everything else ultimately depends on) has the
    // highest depth and `plan` (nothing depends on it) is 0.
    const depth = lineageDepth(["plan.md", "spec.md", "research.md", "sibling.md"], chain);
    expect(depth.get("plan.md")).toBe(0);
    expect(depth.get("spec.md")).toBe(1);
    expect(depth.get("research.md")).toBe(2);
    expect(depth.get("sibling.md")).toBe(0); // only reachable via a non-lineage edge
  });

  test("displayLevel flips lineageDepth: a prerequisite's level is LOWER than the node's, a dependent's is HIGHER", () => {
    const depth = lineageDepth(["plan.md", "spec.md", "research.md", "sibling.md"], chain);
    const level = displayLevel(depth);
    // research.md is spec.md's prerequisite -> must read lower.
    expect(level.get("research.md")!).toBeLessThan(level.get("spec.md")!);
    // plan.md depends on (unlocks from) spec.md -> must read higher.
    expect(level.get("plan.md")!).toBeGreaterThan(level.get("spec.md")!);
    // Root (max lineageDepth) maps to level 0; the shallowest node maps to max level.
    expect(level.get("research.md")).toBe(0);
    expect(level.get("plan.md")).toBe(2);
    expect(level.get("spec.md")).toBe(1);
  });
});
