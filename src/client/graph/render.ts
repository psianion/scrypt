// Pixi.js + D3 force-directed graph renderer.
// Ported from Quartz v4 (quartz/components/scripts/graph.inline.ts) and adapted
// for Scrypt's snapshot shape and tier filter model.
//
// Notes on intentional simplifications vs Quartz:
// - No tag nodes; snapshot is pre-resolved.
// - Edge tier styling is encoded via alpha/width only (Pixi Graphics has no
//   native dashed/dotted stroke). connected = 1.0 alpha, mentions = 0.6,
//   semantically_related = 0.4.
// - Visited nodes get a 50% alpha tint.

import { Application, Container, Graphics, Text, Circle } from "pixi.js";
import {
  forceSimulation,
  forceManyBody,
  forceCenter,
  forceLink,
  forceCollide,
  forceRadial,
  zoomIdentity,
  select,
  drag,
  zoom,
  zoomTransform,
  type Simulation,
  type SimulationNodeDatum,
  type SimulationLinkDatum,
  type ZoomTransform,
} from "d3";
import { Group as TweenGroup, Tween } from "@tweenjs/tween.js";
import type { GraphSnapshot, SnapshotEdge } from "../../server/graph/snapshot";
import type { Tier, TierFilter } from "./tierFilter";
import { colorFor, darken } from "./colors";

export interface RenderOpts {
  snap: GraphSnapshot;
  tierFilter: TierFilter;
  visited: Set<string>;
  onNodeClick: (id: string) => void;
  onNodeVisited: (id: string) => void;
  enableRadial: boolean;
  depthLimit: number;
  centerId?: string;
  width: number;
  height: number;
}

export interface RenderHandle {
  canvas: HTMLCanvasElement;
  destroy(): void;
  focusNode(id: string): void;
  updateFilter(f: TierFilter): void;
  updateQueryFilter(nodeIds: Set<string> | null, matches: Set<string>): void;
}

type NodeDatum = SimulationNodeDatum & {
  id: string;
  title: string;
  doc_type: string | null;
  degree: number;
};

type LinkDatum = SimulationLinkDatum<NodeDatum> & {
  source: NodeDatum | string;
  target: NodeDatum | string;
  tier: Tier;
  color: number;
  width: number;
  baseAlpha: number;
};

interface NodeRender {
  data: NodeDatum;
  gfx: Graphics;
  label: Text;
  baseColor: number;
  alpha: number;
  labelAlpha: number;
}

interface LinkRender {
  data: LinkDatum;
  gfx: Graphics;
  alpha: number;
}

function hexToNumber(hex: string): number {
  return parseInt(hex.replace("#", ""), 16);
}

function tierStyle(tier: Tier, srcColor: number): { color: number; width: number; alpha: number } {
  if (tier === "connected") {
    return { color: hexToNumber(darken(numberToHex(srcColor), 0.2)), width: 1.2, alpha: 0.9 };
  }
  if (tier === "mentions") {
    return { color: 0x9aa0aa, width: 1.0, alpha: 0.55 };
  }
  // semantically_related — can be thousands. Visible baseline but muted so
  // explicit links still read as foreground.
  return { color: 0x7a7f88, width: 0.8, alpha: 0.28 };
}

function numberToHex(n: number): string {
  return `#${n.toString(16).padStart(6, "0")}`;
}

function bfs(
  nodes: string[],
  edges: SnapshotEdge[],
  start: string,
  depth: number,
): Set<string> {
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

export function createGraph(parent: HTMLElement, opts: RenderOpts): RenderHandle {
  const { snap, width, height } = opts;

  // Active tier filter (mutable)
  let tierFilter: TierFilter = { ...opts.tierFilter };

  // Determine which nodes to render (BFS if local)
  const allNodeIds = snap.nodes.map((n) => n.id);
  const visibleIds: Set<string> =
    opts.depthLimit === -1 || !opts.centerId
      ? new Set(allNodeIds)
      : bfs(allNodeIds, snap.edges, opts.centerId, opts.depthLimit);

  const nodeDataById = new Map<string, NodeDatum>();
  const nodes: NodeDatum[] = [];
  for (const n of snap.nodes) {
    if (!visibleIds.has(n.id)) continue;
    const datum: NodeDatum = {
      id: n.id,
      title: n.title,
      doc_type: n.doc_type,
      degree: n.degree,
    };
    nodes.push(datum);
    nodeDataById.set(n.id, datum);
  }

  // Build all possible links between visible nodes (we keep them and vary alpha
  // by tier filter so toggling is cheap without re-wiring the simulation).
  const links: LinkDatum[] = [];
  for (const e of snap.edges) {
    if (!nodeDataById.has(e.source) || !nodeDataById.has(e.target)) continue;
    const tier = (e.confidence ?? "connected") as Tier;
    const src = nodeDataById.get(e.source)!;
    const srcColor = hexToNumber(colorFor(src.doc_type));
    const style = tierStyle(tier, srcColor);
    links.push({
      source: src,
      target: nodeDataById.get(e.target)!,
      tier,
      color: style.color,
      width: style.width,
      baseAlpha: style.alpha,
    });
  }

  // Build neighbour map for hover focus
  const neighbours = new Map<string, Set<string>>();
  for (const n of nodes) neighbours.set(n.id, new Set());
  for (const l of links) {
    const s = (l.source as NodeDatum).id;
    const t = (l.target as NodeDatum).id;
    neighbours.get(s)?.add(t);
    neighbours.get(t)?.add(s);
  }

  // Pixi app
  const app = new Application();
  const canvas = document.createElement("canvas");
  parent.appendChild(canvas);

  const tweenGroup = new TweenGroup();
  let rafId = 0;
  let destroyed = false;

  const nodeRender: NodeRender[] = [];
  const linkRender: LinkRender[] = [];
  let currentTransform: ZoomTransform = zoomIdentity;

  // Quartz's formula is `2 + sqrt(degree)`, which works when typical degree is
  // 5–20 (wikilinks only). Scrypt adds semantic similarity edges, pushing hub
  // degree into the 100–200 range — raw `sqrt(degree)` would produce 14px hubs
  // that eat the canvas. Clamp at 8px max so layout stays readable regardless
  // of vault density.
  const nodeRadius = (d: NodeDatum) => 2 + Math.min(6, Math.sqrt(d.degree / 3));

  // Simulation — Quartz defaults: strength(-100 * repelForce), centerForce,
  // linkDistance. We set them directly since we don't read from a D3Config.
  const simulation: Simulation<NodeDatum, LinkDatum> = forceSimulation<NodeDatum>(nodes)
    .force("charge", forceManyBody().strength(-120))
    .force("center", forceCenter(width / 2, height / 2).strength(0.5))
    .force(
      "link",
      forceLink<NodeDatum, LinkDatum>(links).id((n) => n.id).distance(30),
    )
    .force("collide", forceCollide<NodeDatum>((d) => nodeRadius(d)).iterations(3))
    .alphaDecay(0.0228)
    .velocityDecay(0.4);

  if (opts.enableRadial) {
    const radius = (Math.min(width, height) / 2) * 0.8;
    simulation.force("radial", forceRadial(radius, width / 2, height / 2).strength(0.2));
  }

  // Query filter state (applied over tween)
  let queryVisible: Set<string> | null = null;
  let queryMatches: Set<string> = new Set();

  // Quartz-style "active" set: a node is active if it's the hovered node or a
  // 1-hop neighbour of the hovered node. Used to dim everything else.
  function isActive(id: string, hovered: string | null): boolean {
    if (!hovered) return false;
    if (hovered === id) return true;
    return neighbours.get(hovered)?.has(id) ?? false;
  }

  function computeNodeAlpha(id: string, hovered: string | null): number {
    if (hovered) return isActive(id, hovered) ? 1 : 0.2;
    if (queryVisible) {
      if (queryMatches.has(id)) return 1;
      if (queryVisible.has(id)) return 0.7;
      return 0.15;
    }
    return opts.visited.has(id) ? 0.5 : 1;
  }

  function computeLinkAlpha(l: LinkDatum, hovered: string | null): number {
    if (!(tierFilter[l.tier] ?? false)) return 0;
    const s = (l.source as NodeDatum).id;
    const t = (l.target as NodeDatum).id;
    if (hovered) {
      return s === hovered || t === hovered ? 1 : 0.08;
    }
    if (queryVisible) {
      return queryVisible.has(s) && queryVisible.has(t) ? l.baseAlpha : 0.06;
    }
    return l.baseAlpha;
  }

  let hoveredNodeId: string | null = null;

  function computeLabelAlpha(id: string, hovered: string | null): number {
    // Labels off by default (Quartz behaviour). Visible only on hover (self +
    // 1-hop neighbours) or for exact search matches.
    if (hovered) return isActive(id, hovered) ? 1 : 0;
    if (queryVisible && queryMatches.has(id)) return 1;
    return 0;
  }

  function applyStyles(animated: boolean) {
    for (const n of nodeRender) {
      const target = computeNodeAlpha(n.data.id, hoveredNodeId);
      const targetLabel = computeLabelAlpha(n.data.id, hoveredNodeId);
      if (animated) {
        tweenGroup.add(new Tween(n, tweenGroup).to({ alpha: target }, 200).start());
        tweenGroup.add(new Tween({ v: n.label.alpha }, tweenGroup)
          .to({ v: targetLabel }, 150)
          .onUpdate((o) => { n.label.alpha = o.v; })
          .start());
      } else {
        n.alpha = target;
        n.gfx.alpha = target;
        n.label.alpha = targetLabel;
      }
    }
    for (const l of linkRender) {
      const target = computeLinkAlpha(l.data, hoveredNodeId);
      if (animated) {
        tweenGroup.add(new Tween(l, tweenGroup).to({ alpha: target }, 200).start());
      } else {
        l.alpha = target;
      }
    }
  }

  app
    .init({
      canvas,
      width,
      height,
      backgroundAlpha: 0,
      antialias: true,
      resolution: window.devicePixelRatio,
      autoDensity: true,
      autoStart: false,
    })
    .then(() => {
      if (destroyed) return;
      const stage = app.stage;
      const linkContainer = new Container({ zIndex: 1 });
      const nodesContainer = new Container({ zIndex: 2 });
      const labelsContainer = new Container({ zIndex: 3 });
      stage.addChild(linkContainer, nodesContainer, labelsContainer);
      stage.sortableChildren = true;

      // Links
      for (const l of links) {
        const gfx = new Graphics();
        linkContainer.addChild(gfx);
        linkRender.push({ data: l, gfx, alpha: l.baseAlpha });
      }

      // Nodes
      for (const n of nodes) {
        const baseColor = hexToNumber(colorFor(n.doc_type));
        const r = nodeRadius(n);
        const gfx = new Graphics();
        gfx.circle(0, 0, r).fill({ color: baseColor });
        gfx.eventMode = "static";
        gfx.cursor = "pointer";
        gfx.hitArea = new Circle(0, 0, Math.max(r + 3, 8));
        nodesContainer.addChild(gfx);

        // Trim label text — long vault-path titles crush the view.
        const shortTitle =
          n.title.length > 40 ? `${n.title.slice(0, 38)}…` : n.title;
        const label = new Text({
          text: shortTitle,
          alpha: 0,
          style: {
            fontSize: 12,
            fill: 0xe0e0e0,
            fontFamily: "system-ui, -apple-system, sans-serif",
            fontWeight: "500",
          },
          anchor: { x: 0.5, y: 1.4 },
          resolution: window.devicePixelRatio * 2,
        });
        label.eventMode = "none";
        labelsContainer.addChild(label);

        const rec: NodeRender = {
          data: n,
          gfx,
          label,
          baseColor,
          alpha: opts.visited.has(n.id) ? 0.5 : 1.0,
          labelAlpha: 0,
        };
        rec.gfx.alpha = rec.alpha;
        nodeRender.push(rec);

        gfx.on("pointerover", () => {
          hoveredNodeId = n.id;
          applyStyles(true);
        });
        gfx.on("pointerleave", () => {
          if (hoveredNodeId === n.id) hoveredNodeId = null;
          applyStyles(true);
        });
        gfx.on("pointertap", () => {
          opts.onNodeVisited(n.id);
          opts.onNodeClick(n.id);
        });
      }

      applyStyles(false);

      // Pan/zoom
      const sel = select<HTMLCanvasElement, unknown>(canvas);
      const zoomBehavior = zoom<HTMLCanvasElement, unknown>()
        .scaleExtent([0.25, 4])
        .on("zoom", (event) => {
          currentTransform = event.transform;
          stage.scale.set(event.transform.k, event.transform.k);
          stage.position.set(event.transform.x, event.transform.y);
        });
      sel.call(zoomBehavior);
      sel.on("dblclick.zoom", () => {
        sel.transition().duration(400).call(zoomBehavior.transform, zoomIdentity);
      });

      // Drag
      let dragStart = 0;
      sel.call(
        drag<HTMLCanvasElement, unknown>()
          .container(() => canvas)
          .subject((event) => {
            const t = zoomTransform(canvas);
            const x = (event.x - t.x) / t.k;
            const y = (event.y - t.y) / t.k;
            // find nearest node under cursor
            let best: NodeDatum | undefined;
            let bestDist = 16 * 16;
            for (const n of nodes) {
              if (n.x == null || n.y == null) continue;
              const dx = n.x - x;
              const dy = n.y - y;
              const d = dx * dx + dy * dy;
              if (d < bestDist) {
                bestDist = d;
                best = n;
              }
            }
            return best;
          })
          .on("start", (event) => {
            if (!event.subject) return;
            if (!event.active) simulation.alphaTarget(0.3).restart();
            event.subject.fx = event.subject.x;
            event.subject.fy = event.subject.y;
            dragStart = Date.now();
          })
          .on("drag", (event) => {
            if (!event.subject) return;
            event.subject.fx = (event.x - currentTransform.x) / currentTransform.k;
            event.subject.fy = (event.y - currentTransform.y) / currentTransform.k;
          })
          .on("end", (event) => {
            if (!event.subject) return;
            if (!event.active) simulation.alphaTarget(0);
            event.subject.fx = null;
            event.subject.fy = null;
            if (Date.now() - dragStart < 200) {
              // treat as click
              opts.onNodeVisited(event.subject.id);
              opts.onNodeClick(event.subject.id);
            }
          }),
      );

      // Animation loop
      function animate(time: number) {
        if (destroyed) return;
        simulation.tick();
        tweenGroup.update(time);
        for (const n of nodeRender) {
          const { x, y } = n.data;
          if (x == null || y == null) continue;
          n.gfx.position.set(x, y);
          n.label.position.set(x, y);
          n.gfx.alpha = n.alpha;
        }
        for (const l of linkRender) {
          const s = l.data.source as NodeDatum;
          const t = l.data.target as NodeDatum;
          if (s.x == null || s.y == null || t.x == null || t.y == null) continue;
          l.gfx.clear();
          if (l.alpha <= 0.001) continue;
          l.gfx
            .moveTo(s.x, s.y)
            .lineTo(t.x, t.y)
            .stroke({ color: l.data.color, width: l.data.width, alpha: l.alpha });
        }
        app.renderer.render(app.stage);
        rafId = requestAnimationFrame(animate);
      }
      rafId = requestAnimationFrame(animate);
    });

  return {
    get canvas() {
      return canvas;
    },
    destroy() {
      destroyed = true;
      if (rafId) cancelAnimationFrame(rafId);
      simulation.stop();
      tweenGroup.removeAll();
      try {
        app.destroy(true, { children: true });
      } catch {
        // app may not have finished init; ignore
      }
      if (canvas.parentElement === parent) parent.removeChild(canvas);
    },
    focusNode(id: string) {
      const n = nodeDataById.get(id);
      if (!n || n.x == null || n.y == null) return;
      const k = Math.max(1.5, currentTransform.k);
      const tx = width / 2 - n.x * k;
      const ty = height / 2 - n.y * k;
      const sel = select<HTMLCanvasElement, unknown>(canvas);
      const zoomBehavior = zoom<HTMLCanvasElement, unknown>().scaleExtent([0.25, 4]);
      sel
        .transition()
        .duration(400)
        .call(zoomBehavior.transform, zoomIdentity.translate(tx, ty).scale(k));
    },
    updateFilter(f: TierFilter) {
      tierFilter = { ...f };
      applyStyles(true);
    },
    updateQueryFilter(nodeIds: Set<string> | null, matches: Set<string>) {
      queryVisible = nodeIds;
      queryMatches = matches;
      applyStyles(true);
    },
  };
}
