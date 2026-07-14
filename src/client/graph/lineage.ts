// Pure, canvas-free lineage-direction helpers shared by the projector
// (visual dim/highlight) and the detail card / tooltip (breadcrumb + lists).
//
// Direction semantics (see phase-2 spec): edge {source, target}. The SOURCE
// depends on the TARGET ("derives-from", "implements", "supersedes" — same
// doc_type). So for a node X, its prerequisites are found by following
// source→target edges *starting at* X.
import type { SnapshotEdge } from "../../server/graph/snapshot";

export function isLineageEdge(e: Pick<SnapshotEdge, "tier" | "reason">): boolean {
  return (
    e.tier === "connected" &&
    (e.reason === "derives-from" || e.reason === "implements" || e.reason === "supersedes")
  );
}

/**
 * Transitive prerequisite closure of `nodeId`: every node reachable by
 * repeatedly following source→target lineage edges starting at `nodeId`.
 * Excludes `nodeId` itself. Cycle-safe (visited guard).
 */
export function prerequisiteClosure(nodeId: string, edges: SnapshotEdge[]): Set<string> {
  const bySource = new Map<string, string[]>();
  for (const e of edges) {
    if (!isLineageEdge(e)) continue;
    if (!bySource.has(e.source)) bySource.set(e.source, []);
    bySource.get(e.source)!.push(e.target);
  }
  const visited = new Set<string>();
  const stack = [nodeId];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    for (const t of bySource.get(cur) ?? []) {
      if (t === nodeId || visited.has(t)) continue;
      visited.add(t);
      stack.push(t);
    }
  }
  return visited;
}

/** Immediate prerequisite targets of `nodeId` ("builds directly on"). */
export function directPrerequisites(nodeId: string, edges: SnapshotEdge[]): string[] {
  const out: string[] = [];
  for (const e of edges) {
    if (isLineageEdge(e) && e.source === nodeId) out.push(e.target);
  }
  return out;
}

/** Immediate dependents of `nodeId` — nodes X is a prerequisite for ("unlocks next"). */
export function directDependents(nodeId: string, edges: SnapshotEdge[]): string[] {
  const out: string[] = [];
  for (const e of edges) {
    if (isLineageEdge(e) && e.target === nodeId) out.push(e.source);
  }
  return out;
}

/**
 * Displayed "level" for the card/tooltip breadcrumb + lists — the inverse of
 * `lineageDepth`'s own direction (root/foundational notes read numerically
 * LOW, most-derived notes read HIGH, matching Marble). `lineageDepth` itself
 * keeps its original direction (root = highest) since projector.ts's Y-axis
 * layout still depends on that; this is a display-only remap computed once
 * over the depth map (`maxLineageDepth - lineageDepth(id)`).
 */
export function displayLevel(depth: Map<string, number>): Map<string, number> {
  let max = 0;
  for (const v of depth.values()) if (v > max) max = v;
  const out = new Map<string, number>();
  for (const [id, v] of depth) out.set(id, max - v);
  return out;
}

/** Longest chain of lineage edges ending at each node (root = 0). */
export function lineageDepth(nodeIds: string[], edges: SnapshotEdge[]): Map<string, number> {
  const incoming = new Map<string, string[]>();
  for (const id of nodeIds) incoming.set(id, []);
  for (const e of edges) {
    if (!isLineageEdge(e)) continue;
    incoming.get(e.target)?.push(e.source);
  }
  const depth = new Map<string, number>();
  const visiting = new Set<string>();
  function dfs(id: string): number {
    const cached = depth.get(id);
    if (cached !== undefined) return cached;
    if (visiting.has(id)) return 0; // cycle guard
    visiting.add(id);
    let best = 0;
    for (const src of incoming.get(id) ?? []) best = Math.max(best, dfs(src) + 1);
    visiting.delete(id);
    depth.set(id, best);
    return best;
  }
  for (const id of nodeIds) dfs(id);
  return depth;
}
