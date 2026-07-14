import { useNoteExcerpt } from "../graph/useNoteExcerpt";
import "./NodeTooltip.css";

interface Props {
  nodeId: string;
  title: string;
  project: string;
  depth: number;
  color: string;
  x: number;
  y: number;
}

/** Small dark box near the cursor on hover — distinct from the click-to-select
 * detail card. Title-only until the debounced excerpt fetch resolves. */
export function NodeTooltip({ nodeId, title, project, depth, color, x, y }: Props) {
  const excerpt = useNoteExcerpt(nodeId);
  return (
    <div className="node-tooltip" style={{ left: x + 14, top: y + 14 }}>
      <div className="node-tooltip__breadcrumb">
        <span className="node-tooltip__dot" style={{ background: color }} />
        {project} · depth {depth}
      </div>
      <div className="node-tooltip__title">{title}</div>
      {excerpt && <div className="node-tooltip__excerpt">{excerpt}</div>}
    </div>
  );
}
