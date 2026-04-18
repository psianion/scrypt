import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useGraphSnapshot } from "../graph/useGraphSnapshot";
import {
  loadTierFilter,
  saveTierFilter,
  type TierFilter,
} from "../graph/tierFilter";
import { buildSearchIndex, filterGraph } from "../graph/search";
import { createGraph, type RenderHandle } from "../graph/render";

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

export function GraphView() {
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
      depthLimit: -1,
      width: rect.width,
      height: rect.height - 60,
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
    const idx = buildSearchIndex(snap);
    const { nodes } = filterGraph(snap, idx, query);
    if (query.trim() === "") {
      handleRef.current.updateQueryFilter(null, new Set());
    } else {
      const ids = new Set(nodes.map((n) => n.id));
      const matches = new Set(nodes.filter((n) => n.isMatch).map((n) => n.id));
      handleRef.current.updateQueryFilter(ids, matches);
    }
  }, [query, tier, snap]);

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
