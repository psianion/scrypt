import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import * as d3 from "d3";
import { api } from "../api";
import { useStore } from "../store";
import type { GraphNode, GraphEdge } from "../../shared/types";

export function GraphView() {
  const svgRef = useRef<SVGSVGElement>(null);
  const navigate = useNavigate();
  const [filter, setFilter] = useState("");
  const setGraph = useStore((s) => s.setGraph);

  useEffect(() => {
    api.graph
      .full()
      .then((res: any) => {
        const nodes = res?.nodes ?? [];
        const edges = res?.edges ?? [];
        setGraph(nodes, edges);
        renderGraph(nodes, edges);
      })
      .catch(() => {});
  }, []);

  function renderGraph(nodes: GraphNode[], edges: GraphEdge[]) {
    if (!svgRef.current) return;
    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    const width = svgRef.current.clientWidth || 800;
    const height = svgRef.current.clientHeight || 600;

    const g = svg.append("g");

    // Zoom
    svg.call(
      d3.zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.1, 4])
        .on("zoom", (event) => g.attr("transform", event.transform))
    );

    const simulation = d3
      .forceSimulation(nodes as any)
      .force("link", d3.forceLink(edges).id((d: any) => d.id).distance(80))
      .force("charge", d3.forceManyBody().strength(-200))
      .force("center", d3.forceCenter(width / 2, height / 2));

    const link = g
      .selectAll("line")
      .data(edges)
      .join("line")
      .attr("stroke", "#333")
      .attr("stroke-width", 1);

    const node = g
      .selectAll("circle")
      .data(nodes)
      .join("circle")
      .attr("r", (d) => Math.max(4, Math.min(12, (d.connections || 1) * 2)))
      .attr("fill", "#666")
      .attr("stroke", "#888")
      .attr("stroke-width", 1)
      .style("cursor", "pointer")
      .on("click", (_e, d) => {
        useStore.getState().openTab(d.path, d.title);
        navigate(`/note/${d.path}`);
      })
      .on("mouseover", function () { d3.select(this).attr("fill", "#aaa"); })
      .on("mouseout", function () { d3.select(this).attr("fill", "#666"); })
      .call(d3.drag<any, any>()
        .on("start", (event, d) => { if (!event.active) simulation.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
        .on("drag", (event, d) => { d.fx = event.x; d.fy = event.y; })
        .on("end", (event, d) => { if (!event.active) simulation.alphaTarget(0); d.fx = null; d.fy = null; })
      );

    const label = g
      .selectAll("text")
      .data(nodes)
      .join("text")
      .text((d) => d.title)
      .attr("font-size", 10)
      .attr("dx", 12)
      .attr("dy", 4)
      .attr("fill", "var(--text-secondary)");

    simulation.on("tick", () => {
      link
        .attr("x1", (d: any) => d.source.x)
        .attr("y1", (d: any) => d.source.y)
        .attr("x2", (d: any) => d.target.x)
        .attr("y2", (d: any) => d.target.y);
      node.attr("cx", (d: any) => d.x).attr("cy", (d: any) => d.y);
      label.attr("x", (d: any) => d.x).attr("y", (d: any) => d.y);
    });
  }

  return (
    <div data-testid="graph-view" className="flex flex-col h-full">
      <div className="flex items-center gap-2 p-2 border-b border-[var(--border)]">
        <input
          type="text"
          placeholder="Filter by title..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="px-2 py-1 text-sm bg-[var(--bg-secondary)] border border-[var(--border)] rounded text-[var(--text-primary)] outline-none"
        />
      </div>
      <svg ref={svgRef} className="flex-1 w-full" />
    </div>
  );
}
