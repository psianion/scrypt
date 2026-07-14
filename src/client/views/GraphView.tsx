import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import type { SnapshotNode } from "../../server/graph/snapshot";
import { useGraphSnapshot } from "../graph/useGraphSnapshot";
import {
  loadTierFilter,
  saveTierFilter,
  type TierFilter,
} from "../graph/tierFilter";
import { createProjector, type ProjectorHandle, type Selection } from "../graph/projector";
import {
  prerequisiteClosure,
  directPrerequisites,
  directDependents,
  lineageDepth,
  displayLevel,
} from "../graph/lineage";
import {
  edgeStyleFor,
  sourceNodeOpacityFor,
  truncateLabel,
} from "../graph/graphStyle";
import { colorForProject } from "../graph/colors";
import { api } from "../api";
import { GraphChrome } from "../components/GraphChrome";
import { NodeDetailCard, type DetailListItem } from "../components/NodeDetailCard";
import { NodeTooltip } from "../components/NodeTooltip";

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
  const handleRef = useRef<ProjectorHandle | null>(null);

  // ── Phase 2: selection trace, back stack, hover tooltip, legend toggle ──
  const [selected, setSelected] = useState<Selection | null>(null);
  const [backStack, setBackStack] = useState<Selection[]>([]);
  const [hover, setHover] = useState<{ id: string; x: number; y: number } | null>(null);
  const [hiddenProjects, setHiddenProjects] = useState<Set<string>>(new Set());

  const nodeById = useMemo(() => {
    const m = new Map<string, SnapshotNode>();
    if (snap) for (const n of snap.nodes) m.set(n.id, n);
    return m;
  }, [snap]);
  const depthMap = useMemo(
    () => (snap ? lineageDepth(snap.nodes.map((n) => n.id), snap.edges) : new Map<string, number>()),
    [snap],
  );
  // Card/tooltip display only: flips depthMap's direction so prerequisites
  // read as a LOWER level than the node and dependents read HIGHER (Marble
  // parity — see lineage.ts displayLevel). depthMap itself stays untouched
  // since nothing else derives from it.
  const levelMap = useMemo(() => displayLevel(depthMap), [depthMap]);

  function handleSelect(id: string) {
    if (!snap) return;
    const node = nodeById.get(id);
    if (!node) return;
    if (selected && selected.nodeId !== id) setBackStack((st) => [...st, selected]);
    const sel: Selection = {
      nodeId: id,
      ancestorIds: prerequisiteClosure(id, snap.edges),
      color: colorForProject(node.project),
    };
    setSelected(sel);
    handleRef.current?.setSelection(sel);
  }
  function handleDeselect() {
    if (!selected) return;
    setSelected(null);
    setBackStack([]);
    handleRef.current?.setSelection(null);
  }
  function handleBack() {
    if (backStack.length === 0) return;
    const prev = backStack[backStack.length - 1]!;
    setBackStack(backStack.slice(0, -1));
    setSelected(prev);
    handleRef.current?.setSelection(prev);
  }
  function handleHoverChange(id: string | null, x: number, y: number) {
    setHover(id ? { id, x, y } : null);
  }
  function handleToggleProject(project: string) {
    const next = new Set(hiddenProjects);
    if (next.has(project)) next.delete(project);
    else next.add(project);
    setHiddenProjects(next);
    handleRef.current?.setProjectVisibility(next);
  }

  // Stable trampolines: the projector is created once per `snap` and holds
  // onto whatever functions it's given then, but handleSelect/etc. above
  // close over per-render state (selected/backStack/hiddenProjects) — so the
  // projector calls through a ref that's kept pointing at the latest closure.
  const onNodeClickRef = useRef(handleSelect);
  onNodeClickRef.current = handleSelect;
  const onBackgroundClickRef = useRef(handleDeselect);
  onBackgroundClickRef.current = handleDeselect;
  const onHoverRef = useRef(handleHoverChange);
  onHoverRef.current = handleHoverChange;

  useEffect(() => {
    if (!snap || !hostRef.current) return;
    const visited = loadVisited();
    const rect = hostRef.current.getBoundingClientRect();
    handleRef.current = createProjector(hostRef.current, {
      snap,
      tierFilter: tier,
      visited,
      onNodeClick: (id) => onNodeClickRef.current(id),
      onNodeVisited: (id) => {
        visited.add(id);
        saveVisited(visited);
      },
      onBackgroundClick: () => onBackgroundClickRef.current(),
      onHover: (id, x, y) => onHoverRef.current(id, x, y),
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

  // Esc clears the selection.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") handleDeselect();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, backStack]);

  useEffect(() => {
    if (!snap || !focusId || !handleRef.current) return;
    const node = snap.nodes.find((n) => n.id === focusId);
    if (!node) return;
    setQuery(node.title);
    handleRef.current.focusNode(focusId);
    handleSelect(focusId);
    const all = { connected: true, mentions: true, semantically_related: true };
    setTier(all);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const toDetailItems = (ids: string[]): DetailListItem[] =>
    ids
      .map((id) => nodeById.get(id))
      .filter((n): n is SnapshotNode => !!n)
      .map((n) => ({ id: n.id, title: n.title, project: n.project, depth: levelMap.get(n.id) ?? 0 }));

  const buildsOn = useMemo(
    () => (snap && selected ? toDetailItems(directPrerequisites(selected.nodeId, snap.edges)) : []),
    [snap, selected, nodeById, levelMap],
  );
  const unlocks = useMemo(
    () => (snap && selected ? toDetailItems(directDependents(selected.nodeId, snap.edges)) : []),
    [snap, selected, nodeById, levelMap],
  );
  // Legend reflect: projects present anywhere in the lit closure (selected + its ancestors).
  const litProjects = useMemo(() => {
    if (!snap || !selected) return null;
    const ids = new Set([selected.nodeId, ...selected.ancestorIds]);
    const out = new Set<string>();
    for (const n of snap.nodes) if (ids.has(n.id)) out.add(n.project);
    return out;
  }, [snap, selected]);
  const selectedNode = selected ? nodeById.get(selected.nodeId) : null;
  const hoverNode = hover ? nodeById.get(hover.id) : null;

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
      <div ref={hostRef} className="graph-view__canvas">
        <GraphChrome
          snap={snap}
          hiddenProjects={hiddenProjects}
          litProjects={litProjects}
          onToggleProject={handleToggleProject}
        />
        {selected && selectedNode && (
          <NodeDetailCard
            nodeId={selected.nodeId}
            title={selectedNode.title}
            project={selectedNode.project}
            depth={levelMap.get(selected.nodeId) ?? 0}
            color={selected.color}
            prereqCount={selected.ancestorIds.size}
            buildsOn={buildsOn}
            unlocks={unlocks}
            canGoBack={backStack.length > 0}
            onBack={handleBack}
            onClose={handleDeselect}
            onSelect={handleSelect}
            onOpenNote={(id) => navigate(`/note/${id}`)}
          />
        )}
        {hover && hoverNode && hover.id !== selected?.nodeId && (
          <NodeTooltip
            nodeId={hover.id}
            title={hoverNode.title}
            project={hoverNode.project}
            depth={levelMap.get(hover.id) ?? 0}
            color={colorForProject(hoverNode.project)}
            x={hover.x}
            y={hover.y}
          />
        )}
      </div>
    </div>
  );
}
