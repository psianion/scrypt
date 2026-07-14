import { useMemo } from "react";
import type { GraphSnapshot } from "../../server/graph/snapshot";
import { colorForProject } from "../graph/colors";
import "./GraphChrome.css";

interface Props {
  snap: GraphSnapshot;
  /** Projects hidden via legend toggle (fades their nodes+edges out). */
  hiddenProjects?: Set<string>;
  /** When a node is selected, projects present in the lit closure — rows for
   * every other project dim. `null`/undefined = no selection, nothing dims. */
  litProjects?: Set<string> | null;
  onToggleProject?: (project: string) => void;
}

/** Pure DOM/CSS overlay over the funnel-cloud canvas: hero text, project
 * legend, controls hint. */
export function GraphChrome({ snap, hiddenProjects, litProjects, onToggleProject }: Props) {
  const projects = useMemo(() => {
    const counts = new Map<string, number>();
    for (const n of snap.nodes) counts.set(n.project, (counts.get(n.project) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [snap]);

  return (
    <div className="graph-chrome">
      <div className="graph-chrome__hero">
        <h1>Your knowledge, mapped.</h1>
        <p>
          {snap.nodes.length.toLocaleString()} notes across {projects.length} project
          {projects.length === 1 ? "" : "s"}
        </p>
      </div>
      <div className="graph-chrome__bottom">
        <ul className="graph-chrome__legend">
          {projects.map(([project, count]) => {
            const hidden = hiddenProjects?.has(project) ?? false;
            const dimmed = hidden || (litProjects != null && !litProjects.has(project));
            return (
              <li key={project}>
                <button
                  type="button"
                  className={`graph-chrome__legend-item${dimmed ? " is-dimmed" : ""}`}
                  onClick={() => onToggleProject?.(project)}
                  aria-pressed={hidden}
                >
                  <span className="graph-chrome__dot" style={{ background: colorForProject(project) }} />
                  <span className="graph-chrome__legend-label">{project}</span>
                  <span className="graph-chrome__legend-count">{count}</span>
                </button>
              </li>
            );
          })}
        </ul>
        <div className="graph-chrome__hint">Drag to spin · Scroll to zoom · Tap a dot</div>
      </div>
    </div>
  );
}
