// Phase 1: Marble-style fake-3D "funnel cloud" idle view.
//
// Plain 2D canvas (getContext("2d")) with manual perspective projection —
// NOT WebGL, NOT three.js. Layout (x/y/z) is computed ONCE and cached; only
// the camera (yaw/pitch/dolly) animates per frame. This is the sole graph
// renderer — it owns the RenderMode/ProjectorOpts/ProjectorHandle types (the
// old Pixi render.ts is deleted).
//
// Phase 2 (selection trace, tooltip/card picking, per-project legend
// visibility) is implemented below on top of the `pickedId` hover-pick hook —
// see the "Phase 2" section markers.

import {
  forceSimulation,
  forceManyBody,
  forceCollide,
  forceCenter,
  forceX,
  forceY,
  forceZ,
  type Force3DNode,
} from "d3-force-3d";
import { Group as TweenGroup, Tween } from "@tweenjs/tween.js";
import type { GraphSnapshot, SnapshotEdge, SnapshotNode } from "../../server/graph/snapshot";
import type { Tier, TierFilter } from "./tierFilter";
import { colorForProject } from "./colors";
import { lineageDepth } from "./lineage";

export type RenderMode =
  | { kind: "global" }
  | { kind: "local"; centerId: string; depthLimit: number };

/** Phase 2 selection: the traced node + its transitive prerequisite closure
 * (ancestors only, excludes nodeId itself — see lineage.ts). */
export interface Selection {
  nodeId: string;
  ancestorIds: Set<string>;
  color: string;
}

export interface ProjectorOpts {
  snap: GraphSnapshot;
  tierFilter: TierFilter;
  visited: Set<string>;
  onNodeClick: (id: string) => void;
  onNodeVisited: (id: string) => void;
  mode: RenderMode;
  width: number;
  height: number;
  /** Fired on hover-pick change: (id, screen x, screen y) or (null) on leave. */
  onHover?: (id: string | null, x: number, y: number) => void;
  /** Fired when a pick lands on empty canvas (used to clear selection). */
  onBackgroundClick?: () => void;
}

export interface ProjectorHandle {
  canvas: HTMLCanvasElement;
  destroy(): void;
  focusNode(id: string): void;
  updateFilter(f: TierFilter): void;
  updateQueryFilter(nodeIds: Set<string> | null, matches: Set<string>): void;
  setSelection(sel: Selection | null): void;
  /** Set of project names to hide (fades nodes+edges out over ~250ms). */
  setProjectVisibility(hiddenProjects: Set<string>): void;
}

// Switch the Y axis accessor here. 'depth' = longest lineage chain (roots
// low, leaves high). 'date' = creation/mtime order (falls back to degree —
// the snapshot doesn't carry timestamps today).
const Y_MODE: "depth" | "date" = "depth";

const Y_RANGE = 320; // world-space half-height of the cloud (rounded teardrop, ~1.8:1 tall:wide)
const ROTATE_SPEED = 0.22; // rad/s auto-rotate
const FOCAL = 900;
const CLOUD_FILL_FRACTION = 0.95; // cloud diameter as a fraction of the smaller canvas dimension
// Idle state: every edge is a uniform, near-invisible grey thread — nodes
// must dominate the view (Phase 2 owns subject-colored selection traces).
const IDLE_EDGE_COLOR = "rgba(150,155,175,0.06)";
const IDLE_EDGE_WIDTH = 0.5; // CSS px; ctx is DPR-scaled via ctx.scale(dpr,dpr)

// ── small, self-contained helpers (no deps) ────────────────────────────────

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return `#${((c(r) << 16) | (c(g) << 8) | c(b)).toString(16).padStart(6, "0")}`;
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  const d = max - min;
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      default:
        h = (r - g) / d + 4;
    }
    h /= 6;
  }
  return [h, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) {
    const v = l * 255;
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue2rgb = (p2: number, q2: number, t0: number) => {
    let t = t0;
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p2 + (q2 - p2) * 6 * t;
    if (t < 1 / 2) return q2;
    if (t < 2 / 3) return p2 + (q2 - p2) * (2 / 3 - t) * 6;
    return p2;
  };
  return [hue2rgb(p, q, h + 1 / 3) * 255, hue2rgb(p, q, h) * 255, hue2rgb(p, q, h - 1 / 3) * 255];
}

/** Deterministic per-node lightness jitter (~±20%) seeded from the node id. */
function jitterColor(hex: string, seed: string): string {
  const [h, s, l] = rgbToHsl(...hexToRgb(hex));
  const t = (hashString(seed) % 1000) / 1000; // 0..1
  const l2 = Math.max(0.05, Math.min(0.95, l + (t * 2 - 1) * 0.2));
  return rgbToHex(...hslToRgb(h, s, l2));
}

function normalizeMinMax(m: Map<string, number>): Map<string, number> {
  let min = Infinity;
  let max = -Infinity;
  for (const v of m.values()) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const range = max - min;
  const out = new Map<string, number>();
  for (const [k, v] of m) out.set(k, range > 0 ? -1 + (2 * (v - min)) / range : 0);
  return out;
}

/** Created/mtime accessor — falls back to degree since the snapshot has no timestamps yet. */
function computeDateOrDegree(nodes: SnapshotNode[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const n of nodes) {
    const anyN = n as unknown as { created?: string | number; mtime?: string | number };
    const raw = anyN.created ?? anyN.mtime;
    const parsed = raw != null ? new Date(raw as string | number).getTime() : NaN;
    out.set(n.id, Number.isFinite(parsed) ? parsed : n.degree);
  }
  return out;
}

function bfs(nodes: string[], edges: SnapshotEdge[], start: string, depth: number): Set<string> {
  const adj = new Map<string, Set<string>>();
  for (const id of nodes) adj.set(id, new Set());
  for (const e of edges) {
    adj.get(e.source)?.add(e.target);
    adj.get(e.target)?.add(e.source);
  }
  const visited = new Set<string>([start]);
  let frontier = new Set<string>([start]);
  for (let d = 0; d < depth; d++) {
    const next = new Set<string>();
    for (const id of frontier) {
      for (const nb of adj.get(id) ?? []) {
        if (!visited.has(nb)) {
          visited.add(nb);
          next.add(nb);
        }
      }
    }
    frontier = next;
    if (frontier.size === 0) break;
  }
  return visited;
}

interface SimNode extends Force3DNode {
  id: string;
  degree: number;
}

/** World-space collide radius per node — bigger than the on-screen dot so the
 * relaxation still leaves visible gaps between nodes once projected. */
function nodeWorldRadius(degree: number): number {
  return 9 + Math.min(26, Math.sqrt(degree / 3) * 10);
}

/**
 * One-shot 3D force relaxation (d3-force-3d; layout math only, still a plain
 * 2D canvas renderer). Packs nodes into a dense volume: charge + collision
 * do the packing, a moderate-strength forceY nudges each node toward its
 * (already flipped + jittered) Y target so a vertical gradient survives
 * without producing rigid strands or visible depth-band stripes. Internal
 * timer is stopped immediately; ticked synchronously.
 */
function computeLayout3D(
  visibleNodes: SnapshotNode[],
  _edges: SnapshotEdge[],
  _visibleIds: Set<string>,
  yTargetFor: (id: string) => number,
): Map<string, { x: number; y: number; z: number }> {
  const simNodes: SimNode[] = visibleNodes.map((n) => ({
    id: n.id,
    degree: n.degree,
    x: (Math.random() - 0.5) * 40,
    y: (Math.random() - 0.5) * 40,
    z: (Math.random() - 0.5) * 40,
  }));
  // No link force: lineage edges only exist within a project, so link-driven
  // attraction pulls each project into its own island. Cohesion instead comes
  // from gentle charge + forceX/forceZ centering + collision, which is what
  // lets the 8 project colors intermix through one mass instead of
  // segregating into per-project blobs (floaters included — they have no
  // links either way).
  const sim = forceSimulation(simNodes, 3)
    .force("charge", forceManyBody().strength(-16))
    // Single collide iteration: the octree rebuild dominates its per-tick
    // cost far more than the iteration count does (measured), so this is
    // the cheap way to cut cost without losing density.
    .force("collide", forceCollide((d: SimNode) => nodeWorldRadius(d.degree)).iterations(1))
    .force("center", forceCenter(0, 0, 0))
    .force("x", forceX(0).strength(0.13))
    .force("z", forceZ(0).strength(0.13))
    .force("y", forceY((d: SimNode) => yTargetFor(d.id)).strength(0.35))
    .alphaDecay(0.08)
    .alphaMin(0.01)
    .stop();
  // 50 ticks * alphaDecay(0.08) reaches alpha ~alphaMin well before the loop
  // ends (already converged), so this isn't cutting the sim off early — it's
  // just not paying for ticks whose alpha is too small to move anything.
  for (let i = 0; i < 50; i++) sim.tick();
  const out = new Map<string, { x: number; y: number; z: number }>();
  for (const nd of simNodes) out.set(nd.id, { x: nd.x ?? 0, y: nd.y ?? 0, z: nd.z ?? 0 });
  return out;
}

interface Node3D {
  id: string;
  project: string;
  degree: number;
  x: number;
  y: number;
  z: number;
  color: string;
  radius: number;
}

interface Edge3D {
  s: number;
  t: number;
  tier: Tier;
  color: string;
  alpha: number;
}

export function createProjector(parent: HTMLElement, opts: ProjectorOpts): ProjectorHandle {
  const canvas = document.createElement("canvas");
  parent.appendChild(canvas);

  const inert: ProjectorHandle = {
    canvas,
    destroy() {
      if (canvas.parentElement === parent) parent.removeChild(canvas);
    },
    focusNode() {},
    updateFilter() {},
    updateQueryFilter() {},
    setSelection() {},
    setProjectVisibility() {},
  };

  try {
    const ctx = canvas.getContext("2d");
    if (!ctx) return inert; // e.g. happy-dom in tests has no canvas backend
    return startProjector(canvas, ctx, parent, opts);
  } catch (err) {
    console.warn("[graph] projector init failed:", err);
    return inert;
  }
}

function startProjector(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  parent: HTMLElement,
  opts: ProjectorOpts,
): ProjectorHandle {
  const { snap, width, height } = opts;

  const allNodeIds = snap.nodes.map((n) => n.id);
  const visibleIds: Set<string> =
    opts.mode.kind === "global" ? new Set(allNodeIds) : bfs(allNodeIds, snap.edges, opts.mode.centerId, opts.mode.depthLimit);

  const visibleNodes = snap.nodes.filter((n) => visibleIds.has(n.id));
  const visibleNodeIds = visibleNodes.map((n) => n.id);

  const depthRaw = lineageDepth(visibleNodeIds, snap.edges);
  const depthNorm = normalizeMinMax(depthRaw);
  const dateNorm = normalizeMinMax(computeDateOrDegree(visibleNodes));
  // -1 = shallow/low-lineage-depth (the bulk of nodes, incl. zero-degree ones), +1 = deep/sparse.
  const yNormFor = (id: string) => (Y_MODE === "depth" ? depthNorm.get(id) ?? 0 : dateNorm.get(id) ?? 0);

  // Lineage depth is a small integer (0-9), so a plain yNormFor->Y_RANGE mapping
  // snaps nodes onto ~10 flat discs. Deterministic per-node jitter (seeded by id,
  // no Math.random) of about ±0.5 of one band's spacing blends those bands into
  // a continuous cloud instead of visible horizontal stripes.
  let depthMin = Infinity;
  let depthMax = -Infinity;
  for (const v of depthRaw.values()) {
    if (v < depthMin) depthMin = v;
    if (v > depthMax) depthMax = v;
  }
  const bandSpacingWorld = Y_MODE === "depth" && depthMax > depthMin ? (Y_RANGE * 2) / (depthMax - depthMin) : 0;
  const jitterFor = (id: string) => ((hashString(id) % 1000) / 1000 - 0.5) * bandSpacingWorld;

  // Flip: the dense/shallow end (yNormFor -1) must land at screen-bottom (+Y_RANGE),
  // the sparse/deep end (yNormFor +1) at screen-top (-Y_RANGE) — Marble's silhouette
  // is a rounded mass at the bottom tapering to a loose scatter at the top.
  const yTargetFor = (id: string) => -yNormFor(id) * Y_RANGE + jitterFor(id);
  // Local (ego) mode: a depth-1 neighborhood degenerates under the global
  // depth-Y force layout (everything lands on one vertical strand), so use a
  // deterministic ring instead — center node at the origin, neighbors evenly
  // spaced on an X/Z circle, small seeded Y jitter to break coplanarity. The
  // camera auto-fit below sizes off actual positions, so Y_RANGE/2 only sets
  // proportions.
  let layout3d: Map<string, { x: number; y: number; z: number }>;
  if (opts.mode.kind === "local") {
    const centerId = opts.mode.centerId;
    const ring = visibleNodeIds.filter((id) => id !== centerId).sort();
    const ringR = Y_RANGE / 2;
    layout3d = new Map([[centerId, { x: 0, y: 0, z: 0 }]]);
    ring.forEach((id, i) => {
      const angle = (i / ring.length) * Math.PI * 2;
      layout3d.set(id, {
        x: Math.cos(angle) * ringR,
        y: ((hashString(id) % 1000) / 1000 - 0.5) * ringR * 0.4,
        z: Math.sin(angle) * ringR,
      });
    });
  } else {
    layout3d = computeLayout3D(visibleNodes, snap.edges, visibleIds, yTargetFor);
  }

  // Recenter on the cloud's bounding-box center — NOT the centroid/mean. A
  // top-heavy/tapered distribution (this teardrop) skews the mean away from
  // the visible shape's middle, so the mean leaves the cloud looking
  // off-center. bbox center = (min+max)/2 per axis is skew-proof: it centers
  // the actual visible extent regardless of density. The camera auto-fit
  // below (and the fixed cx/cy screen projection) assumes the cloud sits at
  // the world origin.
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const p of layout3d.values()) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
    if (p.z < minZ) minZ = p.z;
    if (p.z > maxZ) maxZ = p.z;
  }
  const hasNodes = layout3d.size > 0;
  const centroidX = hasNodes ? (minX + maxX) / 2 : 0;
  const centroidY = hasNodes ? (minY + maxY) / 2 : 0;
  const centroidZ = hasNodes ? (minZ + maxZ) / 2 : 0;

  const nodes3d: Node3D[] = visibleNodes.map((n) => {
    const p = layout3d.get(n.id) ?? { x: 0, y: 0, z: 0 };
    // Subtle taper (rounded teardrop, not a rigid funnel): the dense/shallow
    // end (bottom, after the Y-flip above) spreads wider; the sparse/deep end
    // (top) narrows in. denseFrac is 1 at the shallow end, 0 at the deep end.
    const denseFrac = (1 - yNormFor(n.id)) / 2;
    const funnel = 0.85 + 0.15 * denseFrac;
    return {
      id: n.id,
      project: n.project,
      degree: n.degree,
      x: (p.x - centroidX) * funnel,
      z: (p.z - centroidZ) * funnel,
      y: p.y - centroidY,
      color: jitterColor(colorForProject(n.project), n.id),
      radius: 2.5 + Math.min(9, Math.sqrt(n.degree / 2)),
    };
  });

  const indexById = new Map(nodes3d.map((n, i) => [n.id, i]));
  // The idle thread style is tuned for thousands of edges; an ego graph has a
  // handful, so draw them clearly. ponytail: uniform color — tier coloring if asked.
  const isLocal = opts.mode.kind === "local";
  const edgeColor = isLocal ? "rgba(150,155,175,0.45)" : IDLE_EDGE_COLOR;
  const edgeWidth = isLocal ? 1.5 : IDLE_EDGE_WIDTH;
  const edges3d: Edge3D[] = [];
  for (const e of snap.edges) {
    const si = indexById.get(e.source);
    const ti = indexById.get(e.target);
    if (si === undefined || ti === undefined) continue;
    edges3d.push({ s: si, t: ti, tier: e.tier, color: edgeColor, alpha: 1 });
  }

  // Auto-fit camera: size the base dolly distance so the cloud's bounding
  // sphere fills ~90% of the smaller canvas dimension, centered in frame.
  let boundRadius = 1;
  for (const nd of nodes3d) {
    const r = Math.hypot(nd.x, nd.y, nd.z);
    if (r > boundRadius) boundRadius = r;
  }
  const minDim = Math.min(width, height) || 800;
  const baseCamDist = (FOCAL * boundRadius) / (CLOUD_FILL_FRACTION * (minDim / 2));
  // Deep zoom-in (Marble-style: scroll until individual dots are large and
  // separated) needs a much lower floor than the old 0.35 — 0.12 lets camDist
  // approach the cloud surface. The Math.max(60, ...) floor still prevents
  // the perspective denom from inverting/blanking at extreme zoom.
  const MIN_CAM_DIST = Math.max(60, baseCamDist * 0.12);
  const MAX_CAM_DIST = baseCamDist * 2.5;

  const n = nodes3d.length;
  const projX = new Float64Array(n);
  const projY = new Float64Array(n);
  const projR = new Float64Array(n);
  const projDenom = new Float64Array(n);
  const orderArr = Array.from({ length: n }, (_, i) => i);

  let reducedMotion = false;
  try {
    reducedMotion = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    reducedMotion = false;
  }

  // cssWidth/cssHeight (and cx/cy) are re-derived from the live host element's
  // CSS box on every resize, not frozen at the `width`/`height` opts passed in
  // at mount time — that's what keeps cx/cy the TRUE canvas center (so the
  // cloud stays centered) if the container is resized after creation.
  let cssWidth = width;
  let cssHeight = height;
  let cx = cssWidth / 2;
  let cy = cssHeight / 2;

  function resizeCanvas() {
    cssWidth = parent.clientWidth || cssWidth;
    cssHeight = parent.clientHeight || cssHeight;
    const liveDpr = (typeof window !== "undefined" && window.devicePixelRatio) || 1;
    canvas.width = Math.max(1, Math.round(cssWidth * liveDpr));
    canvas.height = Math.max(1, Math.round(cssHeight * liveDpr));
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${cssHeight}px`;
    ctx.setTransform(liveDpr, 0, 0, liveDpr, 0, 0);
    cx = cssWidth / 2;
    cy = cssHeight / 2;
  }
  resizeCanvas();
  canvas.style.touchAction = "none";
  canvas.style.cursor = "grab";

  let resizeObserver: ResizeObserver | null = null;
  if (typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver(() => resizeCanvas());
    resizeObserver.observe(parent);
  }

  let yaw = 0;
  let pitch = 0.35;
  let camDist = baseCamDist;
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  let hoverX: number | null = null;
  let hoverY: number | null = null;
  let pickedId: string | null = null;
  let focusedId: string | null = null;
  let lastHoverId: string | null = null;
  let downX = 0;
  let downY = 0;
  let downTime = 0;
  let downPickedId: string | null = null;

  let tierFilter = { ...opts.tierFilter };
  let queryVisible: Set<string> | null = null;
  let queryMatches: Set<string> = new Set();

  // ── Phase 2: selection (tap-to-trace) ──────────────────────────────────
  // selProgress tweens 0 (idle look) -> 1 (dimmed/highlighted look) over
  // ~450ms on select, and back to 0 over ~350ms on deselect; classification
  // (closureIds/color) is static per selection and just blended by selProgress
  // so switching directly between two selections doesn't need re-tweening.
  let currentSelection: Selection | null = null;
  let closureIds: Set<string> = new Set();
  const selProgressState = { p: 0 };
  let selRotateMul = 1; // eases toward 0 (stop) while a selection is active
  const tweenGroup = new TweenGroup();

  // ── Phase 2: per-project legend visibility toggle ──────────────────────
  let hiddenProjects: Set<string> = new Set();
  const visState: { v: number }[] = Array.from({ length: n }, () => ({ v: 1 }));
  const activeVisTween: (InstanceType<typeof Tween> | null)[] = new Array(n).fill(null);
  let activeSelTween: InstanceType<typeof Tween> | null = null;

  function tweenSelProgress(target: number, duration: number, onComplete?: () => void) {
    activeSelTween?.stop();
    const t = new Tween(selProgressState, tweenGroup).to({ p: target }, duration);
    if (onComplete) t.onComplete(onComplete);
    t.start();
    activeSelTween = t;
  }

  function selMulFor(id: string): number {
    if (!currentSelection) return 1;
    const target = closureIds.has(id) ? 1 : 0.12;
    return 1 + (target - 1) * selProgressState.p; // lerp(1, target, p)
  }

  function nodeAlpha(id: string): number {
    if (queryVisible) {
      if (queryMatches.has(id)) return 1;
      if (queryVisible.has(id)) return 0.7;
      return 0;
    }
    return opts.visited.has(id) ? 0.5 : 1;
  }

  function nearestIndexAt(px: number, py: number): number {
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < n; i++) {
      const dx = projX[i]! - px;
      const dy = projY[i]! - py;
      const d = dx * dx + dy * dy;
      const r = projR[i]! + 3;
      if (d <= r * r && d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  const clampCamDist = (v: number) => Math.max(MIN_CAM_DIST, Math.min(MAX_CAM_DIST, v));

  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    // Multiplicative (not additive) step: the zoom range now spans MIN_CAM_DIST
    // (deep in the cloud) to MAX_CAM_DIST (far out) — a fixed additive step is
    // either too coarse near MIN or too slow near MAX. Scaling by camDist itself
    // keeps each wheel tick a ~consistent relative zoom at any depth, like Marble.
    camDist = clampCamDist(camDist * (1 + e.deltaY * 0.0012));
  };
  const onPointerDown = (e: PointerEvent) => {
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    downX = e.clientX;
    downY = e.clientY;
    downTime = typeof performance !== "undefined" ? performance.now() : Date.now();
    const rect = canvas.getBoundingClientRect();
    const bi = nearestIndexAt(e.clientX - rect.left, e.clientY - rect.top);
    downPickedId = bi >= 0 ? nodes3d[bi]!.id : null;
    // Hide the hover tooltip while dragging/tapping — it reappears on the next hover.
    if (lastHoverId !== null) {
      lastHoverId = null;
      opts.onHover?.(null, 0, 0);
    }
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {}
    canvas.style.cursor = "grabbing";
  };
  const onPointerMove = (e: PointerEvent) => {
    if (dragging) {
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      yaw += dx * 0.006;
      pitch = Math.max(-1.1, Math.min(0.5, pitch - dy * 0.006));
      return;
    }
    const rect = canvas.getBoundingClientRect();
    hoverX = e.clientX - rect.left;
    hoverY = e.clientY - rect.top;
  };
  const onPointerUp = (e: PointerEvent) => {
    dragging = false;
    canvas.style.cursor = pickedId ? "pointer" : "grab";
    try {
      canvas.releasePointerCapture(e.pointerId);
    } catch {}
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    const moved = Math.hypot(e.clientX - downX, e.clientY - downY);
    if (moved < 6 && now - downTime < 500) {
      // A tap/click, not a drag.
      if (downPickedId) {
        opts.onNodeVisited(downPickedId);
        opts.onNodeClick(downPickedId);
      } else {
        opts.onBackgroundClick?.();
      }
    }
  };
  const onPointerLeave = () => {
    if (!dragging) {
      hoverX = null;
      hoverY = null;
      if (lastHoverId !== null) {
        lastHoverId = null;
        opts.onHover?.(null, 0, 0);
      }
    }
  };

  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointerleave", onPointerLeave);

  let rafId = 0;
  let destroyed = false;
  let lastTime = typeof performance !== "undefined" ? performance.now() : 0;

  function frame(now: number) {
    if (destroyed) return;
    const dt = Math.min(0.05, (now - lastTime) / 1000);
    lastTime = now;
    tweenGroup.update(now);

    // ponytail: time-based sine, not a tween — cheap per-frame math, no extra
    // state to manage. 0..1 over a 1.6s period (matches the CSS pulse elsewhere).
    const focusPulse = focusedId ? (Math.sin((now / 1000) * ((2 * Math.PI) / 1.6)) + 1) / 2 : 0;

    // Auto-rotation eases toward a near-stop while a selection is active,
    // and back to full speed on deselect (exponential smoothing, not a
    // one-shot tween — this value keeps moving every frame).
    const rotateTarget = currentSelection ? 0.12 : 1;
    selRotateMul += (rotateTarget - selRotateMul) * Math.min(1, dt * 3);
    if (!dragging && !reducedMotion) yaw += ROTATE_SPEED * selRotateMul * dt;

    const cosY = Math.cos(yaw);
    const sinY = Math.sin(yaw);
    const cosP = Math.cos(pitch);
    const sinP = Math.sin(pitch);

    for (let i = 0; i < n; i++) {
      const node = nodes3d[i]!;
      const xr = node.x * cosY + node.z * sinY;
      const zr1 = -node.x * sinY + node.z * cosY;
      const yr = node.y * cosP - zr1 * sinP;
      const zr = node.y * sinP + zr1 * cosP;
      const denom = clampCamDist(camDist) - zr; // clamp already guards, denom stays positive by construction
      const persp = FOCAL / denom;
      projX[i] = cx + xr * persp;
      projY[i] = cy + yr * persp;
      projR[i] = Math.max(2, node.radius * persp);
      projDenom[i] = denom;
    }

    if (hoverX != null && hoverY != null && !dragging) {
      const bi = nearestIndexAt(hoverX, hoverY);
      pickedId = bi >= 0 ? nodes3d[bi]!.id : null;
      canvas.style.cursor = pickedId ? "pointer" : "grab";
      if (pickedId !== lastHoverId) {
        lastHoverId = pickedId;
        opts.onHover?.(pickedId, hoverX, hoverY);
      }
    }

    orderArr.sort((a, b) => projDenom[b]! - projDenom[a]!); // painter's algo: far first

    ctx.clearRect(0, 0, cssWidth, cssHeight);

    const selP = selProgressState.p;

    ctx.lineWidth = edgeWidth;
    for (const e of edges3d) {
      if (!(tierFilter[e.tier] ?? false)) continue;
      const sId = nodes3d[e.s]!.id;
      const tId = nodes3d[e.t]!.id;
      const visMul = Math.min(visState[e.s]!.v, visState[e.t]!.v);
      const baseA = e.alpha * Math.min(nodeAlpha(sId), nodeAlpha(tId)) * visMul;
      let strokeColor = e.color;
      let a = baseA;
      if (currentSelection && selP > 0.001) {
        const internal = closureIds.has(sId) && closureIds.has(tId);
        if (internal) {
          strokeColor = currentSelection.color;
          a = baseA * (1 - selP) + 0.85 * selP;
        } else {
          a = baseA * (1 - 0.88 * selP);
        }
      }
      if (a <= 0.01) continue;
      ctx.strokeStyle = strokeColor;
      ctx.globalAlpha = a;
      ctx.beginPath();
      ctx.moveTo(projX[e.s]!, projY[e.s]!);
      ctx.lineTo(projX[e.t]!, projY[e.t]!);
      ctx.stroke();
    }

    for (let k = 0; k < n; k++) {
      const i = orderArr[k]!;
      const node = nodes3d[i]!;
      const a = nodeAlpha(node.id) * selMulFor(node.id) * visState[i]!.v;
      if (a <= 0.01) continue;
      const isFocused = node.id === focusedId;
      const r = isFocused ? projR[i]! * (1 + 0.15 * focusPulse) : projR[i]!;
      if (isFocused) {
        // Soft halo ring behind the dot, pulsing radius+alpha in the node's project color.
        ctx.globalAlpha = a * (0.15 + 0.35 * focusPulse);
        ctx.strokeStyle = colorForProject(node.project);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(projX[i]!, projY[i]!, r + 6 + 4 * focusPulse, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = a;
      ctx.fillStyle = node.id === pickedId ? "#ffffff" : node.color;
      ctx.beginPath();
      ctx.arc(projX[i]!, projY[i]!, r, 0, Math.PI * 2);
      ctx.fill();
    }

    // Halo ring around the selected node, fading in/out with selP.
    if (currentSelection && selP > 0.02) {
      const si = indexById.get(currentSelection.nodeId);
      if (si !== undefined) {
        ctx.globalAlpha = selP;
        ctx.strokeStyle = currentSelection.color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(projX[si]!, projY[si]!, projR[si]! + 5, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;

    rafId = requestAnimationFrame(frame);
  }
  rafId = requestAnimationFrame(frame);

  return {
    get canvas() {
      return canvas;
    },
    destroy() {
      destroyed = true;
      cancelAnimationFrame(rafId);
      resizeObserver?.disconnect();
      tweenGroup.removeAll();
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      if (canvas.parentElement === parent) parent.removeChild(canvas);
    },
    focusNode(id: string) {
      pickedId = id;
      focusedId = id;
    },
    updateFilter(f) {
      tierFilter = { ...f };
    },
    updateQueryFilter(nodeIds, matches) {
      queryVisible = nodeIds;
      queryMatches = matches;
    },
    setSelection(sel) {
      if (sel) {
        currentSelection = sel;
        closureIds = new Set([sel.nodeId, ...sel.ancestorIds]);
        tweenSelProgress(1, 450);
      } else if (currentSelection) {
        tweenSelProgress(0, 350, () => {
          currentSelection = null;
          closureIds = new Set();
        });
      }
    },
    setProjectVisibility(hidden) {
      hiddenProjects = new Set(hidden);
      for (let i = 0; i < n; i++) {
        const target = hiddenProjects.has(nodes3d[i]!.project) ? 0 : 1;
        if (visState[i]!.v === target && !activeVisTween[i]) continue;
        activeVisTween[i]?.stop();
        const t = new Tween(visState[i]!, tweenGroup).to({ v: target }, 250).start();
        activeVisTween[i] = t;
      }
    },
  };
}
