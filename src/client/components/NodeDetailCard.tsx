import { colorForProject } from "../graph/colors";
import { useNoteExcerpt } from "../graph/useNoteExcerpt";
import { truncateLabel } from "../graph/graphStyle";
import "./NodeDetailCard.css";

export interface DetailListItem {
  id: string;
  title: string;
  project: string;
  depth: number;
}

interface Props {
  nodeId: string;
  title: string;
  project: string;
  depth: number;
  color: string;
  prereqCount: number;
  buildsOn: DetailListItem[];
  unlocks: DetailListItem[];
  canGoBack: boolean;
  onBack: () => void;
  onClose: () => void;
  onSelect: (id: string) => void;
  onOpenNote: (id: string) => void;
}

const LIST_CAP = 6;

function ItemRow({ item, onSelect }: { item: DetailListItem; onSelect: (id: string) => void }) {
  return (
    <li>
      <button type="button" className="node-card__row" onClick={() => onSelect(item.id)}>
        <span className="node-card__dot" style={{ background: colorForProject(item.project) }} />
        <span className="node-card__row-title">{truncateLabel(item.title)}</span>
        <span className="node-card__row-depth">depth {item.depth}</span>
      </button>
    </li>
  );
}

function ItemList({
  heading,
  items,
  onSelect,
}: {
  heading: string;
  items: DetailListItem[];
  onSelect: (id: string) => void;
}) {
  if (items.length === 0) return null;
  const shown = items.slice(0, LIST_CAP);
  return (
    <div className="node-card__section">
      <h5>
        {heading} {items.length}
      </h5>
      <ul className="node-card__list">
        {shown.map((it) => (
          <ItemRow key={it.id} item={it} onSelect={onSelect} />
        ))}
      </ul>
      {items.length > LIST_CAP && (
        <div className="node-card__more">+{items.length - LIST_CAP} more</div>
      )}
    </div>
  );
}

export function NodeDetailCard({
  nodeId,
  title,
  project,
  depth,
  color,
  prereqCount,
  buildsOn,
  unlocks,
  canGoBack,
  onBack,
  onClose,
  onSelect,
  onOpenNote,
}: Props) {
  const excerpt = useNoteExcerpt(nodeId);

  return (
    <aside className="node-card" data-testid="node-detail-card">
      <button type="button" className="node-card__close" onClick={onClose} aria-label="Close">
        ×
      </button>
      {canGoBack && (
        <button type="button" className="node-card__back" onClick={onBack}>
          ← Back
        </button>
      )}
      <div className="node-card__breadcrumb">
        <span className="node-card__dot" style={{ background: color }} />
        {project} · depth {depth}
      </div>
      <h3 className="node-card__title">{title}</h3>
      {excerpt && <p className="node-card__excerpt">{excerpt}</p>}
      <div className="node-card__big">{prereqCount}</div>
      <div className="node-card__big-label">prerequisites in total</div>
      <p className="node-card__caption">Everything this note was built on, traced all the way back.</p>
      <ItemList heading="Builds directly on" items={buildsOn} onSelect={onSelect} />
      <ItemList heading="Unlocks next" items={unlocks} onSelect={onSelect} />
      <button type="button" className="node-card__open" onClick={() => onOpenNote(nodeId)}>
        Open note →
      </button>
    </aside>
  );
}
