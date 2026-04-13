import { useEffect, useRef, useState } from "react";
import * as d3 from "d3";
import type {
  GraphResponse,
  GraphNodeV2 as GraphNode,
  GraphEdgeV2 as GraphEdge,
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

interface SimEdge extends GraphEdge {
  source: SimNode | number;
  target: SimNode | number;
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

  useEffect(() => {
    fetch("/api/graph")
      .then((r) => r.json())
      .then(setData)
      .catch(() => setData({ nodes: [], edges: [] }));
  }, []);

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
      .attr("stroke", (d) => edgeStroke(d.type))
      .attr("stroke-width", (d) => edgeWidth(d.type))
      .attr("stroke-dasharray", (d) => (d.type === "tag" ? "2 3" : null));

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

    simRef.current = sim;
    return () => {
      sim.stop();
    };
  }, [data]);

  return (
    <div className="h-full w-full relative bg-[var(--bg-primary)]">
      <svg ref={svgRef} className="h-full w-full" />
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
