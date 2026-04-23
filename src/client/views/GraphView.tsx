import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useGraphSnapshot } from "../graph/useGraphSnapshot";
import {
  loadTierFilter,
  saveTierFilter,
  type TierFilter,
} from "../graph/tierFilter";
import { createGraph, type RenderHandle } from "../graph/render";
import {
  edgeStyleFor,
  sourceNodeOpacityFor,
  truncateLabel,
} from "../graph/graphStyle";
import { api } from "../api";

const VISITED_KEY = "graph-visited";

function loadVisited(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(VISITED_KEY) ?? "[]"));
  } catch {
    return new Set();
  }
}
function saveVisited(v: Set<string>) {
  localStorage.setItem(VISITED_KEY, JSON.stringify([...v]));
}

// Loose shapes — the presentational graph accepts anything with {id,title}
// for nodes and {source,target,tier,reason} for edges. Full typing would
// overconstrain callers (graph snapshot nodes carry degree/community, plain
// API nodes do not).
export interface GraphViewNode {
  id: string;
  title: string;
  project?: string | null;
  doc_type?: string | null;
  path?: string;
  slug?: string | null;
}

export interface GraphViewEdge {
  source: string;
  target: string;
  tier: string;
  reason: string | null;
}

export interface GraphViewProps {
  /** Optional explicit node set. When provided with `edges`, renders the
   * presentational SVG variant instead of the snapshot-driven Pixi view. */
  nodes?: GraphViewNode[];
  edges?: GraphViewEdge[];
}

export function GraphView(props: GraphViewProps = {}) {
  if (props.nodes !== undefined && props.edges !== undefined) {
    return <PresentationalGraph nodes={props.nodes} edges={props.edges} />;
  }
  return <ConnectedGraph />;
}

// ─────────────────────────────────────────────────────────────────────────
// Presentational — pure, no router, no snapshot fetch, no Pixi.
// Used by the v1 test suite and as an accessible fallback when WebGL is
// unavailable.
// ─────────────────────────────────────────────────────────────────────────

function layoutCircle(
  nodes: GraphViewNode[],
  width: number,
  height: number,
): Map<string, { x: number; y: number }> {
  const cx = width / 2;
  const cy = height / 2;
  const r = Math.min(width, height) * 0.35;
  const out = new Map<string, { x: number; y: number }>();
  const n = nodes.length;
  nodes.forEach((node, i) => {
    const theta = (i / Math.max(1, n)) * Math.PI * 2;
    out.set(node.id, {
      x: cx + Math.cos(theta) * r,
      y: cy + Math.sin(theta) * r,
    });
  });
  return out;
}

function PresentationalGraph({
  nodes,
  edges,
}: {
  nodes: GraphViewNode[];
  edges: GraphViewEdge[];
}) {
  const WIDTH = 480;
  const HEIGHT = 320;

  const positions = useMemo(
    () => layoutCircle(nodes, WIDTH, HEIGHT),
    [nodes],
  );

  const supersededSources = useMemo(() => {
    const s = new Set<string>();
    for (const e of edges) {
      if (sourceNodeOpacityFor(e.tier, e.reason) < 1) s.add(e.source);
    }
    return s;
  }, [edges]);

  return (
    <div className="graph-view" data-testid="graph-view">
      <svg
        width={WIDTH}
        height={HEIGHT}
        role="img"
        aria-label="Graph"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <marker
            id="graph-arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M0,0 L10,5 L0,10 Z" fill="#6b7280" />
          </marker>
        </defs>
        {edges.map((e, i) => {
          const style = edgeStyleFor(e.tier, e.reason);
          const a = positions.get(e.source);
          const b = positions.get(e.target);
          if (!a || !b) return null;
          return (
            <line
              key={`${e.source}->${e.target}-${i}`}
              data-edge-source={e.source}
              data-edge-target={e.target}
              data-edge-tier={e.tier}
              data-edge-reason={e.reason ?? ""}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke={style.stroke}
              strokeWidth={style.strokeWidth}
              strokeDasharray={style.dashArray ?? undefined}
              markerEnd={style.arrow ? "url(#graph-arrow)" : undefined}
            />
          );
        })}
        {nodes.map((n) => {
          const pos = positions.get(n.id) ?? { x: 0, y: 0 };
          const isSuperseded = supersededSources.has(n.id);
          const opacity = isSuperseded ? 0.45 : 1;
          const shortTitle = truncateLabel(n.title);
          return (
            <g
              key={n.id}
              data-node-id={n.id}
              data-opacity={opacity}
              opacity={opacity}
              transform={`translate(${pos.x},${pos.y})`}
            >
              <circle r={6} fill="#6b7280" />
              {/* Full title goes in a <title> child for accessible
                  tooltips (§6.1.1). The `.label` tspan holds the
                  truncated text so its `textContent` stays ≤40. */}
              <text x={10} y={4} fontSize={12} fill="#e0e0e0">
                <title>
                  {n.title}
                  {n.slug ? `\n${n.slug}` : ""}
                </title>
                <tspan
                  className="label"
                  data-slug={n.slug ?? ""}
                  {...({ title: n.title } as Record<string, string>)}
                >
                  {shortTitle}
                </tspan>
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Connected — uses router + graph snapshot + Pixi renderer (production).
// ─────────────────────────────────────────────────────────────────────────

function ConnectedGraph() {
  const { snap, error } = useGraphSnapshot();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const focusId = params.get("focus");

  const [query, setQuery] = useState("");
  const [tier, setTier] = useState<TierFilter>(() => loadTierFilter());
  const hostRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<RenderHandle | null>(null);

  useEffect(() => {
    if (!snap || !hostRef.current) return;
    const visited = loadVisited();
    const rect = hostRef.current.getBoundingClientRect();
    handleRef.current = createGraph(hostRef.current, {
      snap,
      tierFilter: tier,
      visited,
      onNodeClick: (id) => {
        navigate(`/note/${id}`);
      },
      onNodeVisited: (id) => {
        visited.add(id);
        saveVisited(visited);
      },
      enableRadial: true,
      mode: { kind: "global" },
      width: rect.width,
      height: rect.height,
    });
    return () => {
      handleRef.current?.destroy();
      handleRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap]);

  useEffect(() => {
    if (!snap || !focusId || !handleRef.current) return;
    const node = snap.nodes.find((n) => n.id === focusId);
    if (!node) return;
    setQuery(node.title);
    handleRef.current.focusNode(focusId);
    const all = { connected: true, mentions: true, semantically_related: true };
    setTier(all);
  }, [snap, focusId]);

  useEffect(() => {
    if (!snap || !handleRef.current) return;
    handleRef.current.updateFilter(tier);
  }, [tier, snap]);

  // Server-backed hybrid search: BM25 over the wide notes_fts index +
  // embedding cosine, fused via Reciprocal Rank Fusion (k=60). When ?focus=
  // is set in the URL, hits closer to the focused note are boosted via BFS
  // hop distance over the snapshot's edge graph. Debounced.
  useEffect(() => {
    if (!snap || !handleRef.current) return;
    const handle = handleRef.current;
    const q = query.trim();
    if (q === "") {
      handle.updateQueryFilter(null, new Set());
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const { hits } = await api.graphSearch(q, { focus: focusId });
        if (cancelled) return;
        const snapIds = new Set(snap.nodes.map((n) => n.id));
        const matches = new Set(
          hits.map((h) => h.path).filter((p) => snapIds.has(p)),
        );
        const adjacency = new Map<string, Set<string>>();
        for (const e of snap.edges) {
          if (!adjacency.has(e.source)) adjacency.set(e.source, new Set());
          if (!adjacency.has(e.target)) adjacency.set(e.target, new Set());
          adjacency.get(e.source)!.add(e.target);
          adjacency.get(e.target)!.add(e.source);
        }
        const visible = new Set<string>(matches);
        for (const m of matches) {
          for (const nb of adjacency.get(m) ?? []) visible.add(nb);
        }
        if (!cancelled && handle) {
          handle.updateQueryFilter(visible, matches);
        }
      } catch (err) {
        if ((err as { name?: string })?.name === "AbortError") return;
        console.warn("[graph] search failed:", err);
      }
    }, 220);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, snap]);

  const setTierPersist = (next: TierFilter) => {
    setTier(next);
    saveTierFilter(localStorage, next);
  };

  if (error)
    return (
      <div className="graph-view" data-testid="graph-view">
        Failed to load graph: {error.message}
      </div>
    );
  if (!snap)
    return (
      <div className="graph-view" data-testid="graph-view">
        Loading graph…
      </div>
    );

  return (
    <div className="graph-view" data-testid="graph-view">
      <header className="graph-view__top">
        <input
          type="search"
          placeholder="Search notes…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="graph-view__search"
        />
        <div className="graph-view__tiers">
          <label>
            <input
              type="checkbox"
              checked={tier.connected}
              onChange={(e) => setTierPersist({ ...tier, connected: e.target.checked })}
            />
            connected
          </label>
          <label>
            <input
              type="checkbox"
              checked={tier.mentions}
              onChange={(e) => setTierPersist({ ...tier, mentions: e.target.checked })}
            />
            mentions
          </label>
          <label>
            <input
              type="checkbox"
              checked={tier.semantically_related}
              onChange={(e) =>
                setTierPersist({ ...tier, semantically_related: e.target.checked })
              }
            />
            semantic
          </label>
        </div>
      </header>
      <div ref={hostRef} className="graph-view__canvas" />
    </div>
  );
}
