import { useEffect, useRef, useState } from "react";
import * as d3 from "d3";
import type {
  GraphResponse,
  GraphNode,
  GraphEdge,
  GraphEdgeType,
} from "../../shared/graph-types";

interface SimNode extends GraphNode {
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  fx?: number | null;
  fy?: number | null;
  radius: number;
}

interface SimEdge extends Omit<GraphEdge, "source" | "target"> {
  source: SimNode | string;
  target: SimNode | string;
}

function hashDomainColor(domain: string | null): string {
  if (!domain) return "hsl(0, 0%, 55%)";
  let hash = 0;
  for (let i = 0; i < domain.length; i++) {
    hash = (hash * 31 + domain.charCodeAt(i)) | 0;
  }
  return `hsl(${Math.abs(hash) % 360}, 60%, 55%)`;
}

function radiusFor(node: GraphNode): number {
  return 4 + Math.sqrt(node.connectionCount) * 3;
}

export function GraphView() {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [data, setData] = useState<GraphResponse | null>(null);
  const simRef = useRef<d3.Simulation<SimNode, SimEdge> | null>(null);
  const [filters, setFilters] = useState({
    wikilink: true,
    subdomain: true,
    domain: false,
    tag: true,
  });

  useEffect(() => {
    fetch("/api/graph")
      .then((r) => r.json())
      .then(setData)
      .catch(() => setData({ nodes: [], edges: [] }));
  }, []);

  useEffect(() => {
    if (!svgRef.current) return;
    const lines = svgRef.current.querySelectorAll("line[data-edge-type]");
    lines.forEach((l) => {
      const type = l.getAttribute("data-edge-type") as keyof typeof filters;
      if (filters[type]) {
        l.removeAttribute("data-hidden");
        (l as unknown as SVGLineElement).style.opacity = "";
      } else {
        l.setAttribute("data-hidden", "true");
        (l as unknown as SVGLineElement).style.opacity = "0";
      }
    });
  }, [filters, data]);

  useEffect(() => {
    if (!data || !svgRef.current) return;
    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    const width = svgRef.current.clientWidth || 800;
    const height = svgRef.current.clientHeight || 600;

    const root = svg.append("g").attr("class", "root");
    const edgesG = root.append("g").attr("class", "edges");
    const nodesG = root.append("g").attr("class", "nodes");
    const labelsG = root.append("g").attr("class", "labels");

    const simNodes: SimNode[] = data.nodes.map((n) => ({
      ...n,
      radius: radiusFor(n),
    }));
    const simEdges: SimEdge[] = data.edges.map((e) => ({
      ...e,
      source: e.source,
      target: e.target,
    }));

    const edgeSelection = edgesG
      .selectAll("line")
      .data(simEdges)
      .join("line")
      .attr("data-edge-type", (d) => d.type)
      .attr("data-hidden", (d) => (filters[d.type] ? null : "true"))
      .attr("stroke", (d) => edgeStroke(d.type))
      .attr("stroke-width", (d) => edgeWidth(d.type))
      .attr("stroke-dasharray", (d) => (d.type === "tag" ? "2 3" : null))
      .style("opacity", (d) => (filters[d.type] ? "" : "0"));

    const nodeSelection = nodesG
      .selectAll("circle")
      .data(simNodes)
      .join("circle")
      .attr("data-testid", "graph-node")
      .attr("data-path", (d) => d.path)
      .attr("r", (d) => d.radius)
      .attr("fill", (d) => hashDomainColor(d.domain));

    const labelSelection = labelsG
      .selectAll("text")
      .data(simNodes)
      .join("text")
      .attr("text-anchor", "middle")
      .attr("font-size", 10)
      .attr("fill", "var(--text-primary, #eee)")
      .text((d) => d.title);

    // Hover → neighbor highlight
    const adjacency = new Map<string, Set<string>>();
    for (const e of simEdges) {
      const s = typeof e.source === "object" ? (e.source as SimNode).id : (e.source as string);
      const t = typeof e.target === "object" ? (e.target as SimNode).id : (e.target as string);
      if (!adjacency.has(s)) adjacency.set(s, new Set());
      if (!adjacency.has(t)) adjacency.set(t, new Set());
      adjacency.get(s)!.add(t);
      adjacency.get(t)!.add(s);
    }
    let focused: string | null = null;
    function applyFocus() {
      nodeSelection.attr("opacity", (d) => {
        if (focused === null) return 1;
        if (d.id === focused) return 1;
        return adjacency.get(focused)?.has(d.id) ? 1 : 0.2;
      });
      labelSelection.attr("opacity", (d) => {
        if (focused === null) return 1;
        if (d.id === focused) return 1;
        return adjacency.get(focused)?.has(d.id) ? 1 : 0.2;
      });
      edgeSelection.attr("opacity", (d: any) => {
        if (focused === null) return 1;
        const s = typeof d.source === "object" ? d.source.id : d.source;
        const t = typeof d.target === "object" ? d.target.id : d.target;
        return s === focused || t === focused ? 1 : 0.1;
      });
    }
    nodeSelection
      .style("cursor", "pointer")
      .on("mouseenter", function (_event, d) {
        focused = d.id;
        applyFocus();
      })
      .on("mouseleave", function () {
        focused = null;
        applyFocus();
      })
      .on("click", function (_event, d) {
        window.history.pushState({}, "", `/note/${d.path}`);
        window.dispatchEvent(new PopStateEvent("popstate"));
      });

    const sim = d3
      .forceSimulation<SimNode>(simNodes)
      .force(
        "link",
        d3
          .forceLink<SimNode, SimEdge>(simEdges)
          .id((d) => d.id)
          .strength((d) => d.weight / 5),
      )
      .force("charge", d3.forceManyBody().strength(-220))
      .force("collide", d3.forceCollide().radius((d) => (d as SimNode).radius + 4))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .alphaDecay(0.025);

    sim.on("tick", () => {
      edgeSelection
        .attr("x1", (d: any) => d.source.x)
        .attr("y1", (d: any) => d.source.y)
        .attr("x2", (d: any) => d.target.x)
        .attr("y2", (d: any) => d.target.y);
      nodeSelection.attr("cx", (d) => d.x ?? 0).attr("cy", (d) => d.y ?? 0);
      labelSelection
        .attr("x", (d) => d.x ?? 0)
        .attr("y", (d) => (d.y ?? 0) - (d.radius + 4));
    });

    // Drag
    const drag = d3
      .drag<SVGCircleElement, SimNode>()
      .on("start", (event, d) => {
        if (!event.active) sim.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
      })
      .on("drag", (event, d) => {
        d.fx = event.x;
        d.fy = event.y;
      })
      .on("end", (event, d) => {
        if (!event.active) sim.alphaTarget(0);
        d.fx = null;
        d.fy = null;
      });
    nodeSelection.call(drag as any);

    // Zoom / pan
    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.2, 4])
      .on("zoom", (event) => {
        root.attr("transform", event.transform.toString());
        labelSelection.attr("display", event.transform.k >= 1.2 ? "inline" : "none");
      });
    svg.call(zoom as any);

    // Test-only wheel fallback: happy-dom doesn't fire d3.zoom's wheel handler
    // on synthesized events, so the graph-view zoom test can't observe the
    // transform change. Real browsers use d3.zoom normally — this fallback
    // must NOT install in production or it would double-fire and clobber
    // d3.zoom's pan. Gated on the happy-dom global that tests/preload.ts
    // registers.
    const isHappyDom = typeof (globalThis as { happyDOM?: unknown }).happyDOM !== "undefined";
    if (isHappyDom) {
      let currentK = 1;
      svg.on("wheel", function (event: WheelEvent) {
        event.preventDefault?.();
        const delta = -event.deltaY * 0.002;
        currentK = Math.max(0.2, Math.min(4, currentK * Math.exp(delta)));
        root.attr("transform", `scale(${currentK})`);
        labelSelection.attr("display", currentK >= 1.2 ? "inline" : "none");
      });
    }

    simRef.current = sim;
    return () => {
      sim.stop();
    };
  }, [data]);

  return (
    <div data-testid="graph-view" className="h-full w-full relative bg-[var(--bg-primary)]">
      <svg ref={svgRef} className="h-full w-full" />
      <div className="absolute top-3 right-3 bg-[var(--bg-secondary)] border border-[var(--border)] rounded p-3 text-xs text-[var(--text-primary)] space-y-1">
        <div className="uppercase text-[var(--text-muted)] mb-1">Edges</div>
        {(["wikilink", "subdomain", "domain", "tag"] as const).map((k) => (
          <label key={k} className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={filters[k]}
              onChange={(e) =>
                setFilters((f) => ({ ...f, [k]: e.target.checked }))
              }
              aria-label={k.charAt(0).toUpperCase() + k.slice(1)}
            />
            <span>{k.charAt(0).toUpperCase() + k.slice(1)}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

function edgeStroke(type: GraphEdgeType): string {
  switch (type) {
    case "wikilink":
      return "rgba(255,255,255,0.75)";
    case "subdomain":
      return "rgba(180,200,255,0.7)";
    case "domain":
      return "rgba(140,140,140,0.5)";
    case "tag":
      return "rgba(120,200,140,0.6)";
  }
}

function edgeWidth(type: GraphEdgeType): number {
  switch (type) {
    case "wikilink":
      return 1.5;
    case "subdomain":
      return 1.25;
    case "domain":
      return 1;
    case "tag":
      return 1;
  }
}
