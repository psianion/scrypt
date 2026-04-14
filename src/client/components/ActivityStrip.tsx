// src/client/components/ActivityStrip.tsx
import { useEmbeddingProgress } from "../stores/embeddingProgress";
import "./ActivityStrip.css";

export function ActivityStrip() {
  const inFlight = useEmbeddingProgress((s) => s.inFlight);
  const entries = Object.values(inFlight);
  if (entries.length === 0) return null;
  return (
    <div className="activity-strip" data-testid="activity-strip">
      {entries.map((e) => {
        const pct =
          e.total > 0 ? Math.round((e.storedCount / e.total) * 100) : 0;
        const elapsed = ((Date.now() - e.startedAt) / 1000).toFixed(1);
        return (
          <div
            key={e.notePath}
            className="activity-row"
            data-testid={`activity-${e.notePath}`}
          >
            <span className="activity-spinner" />
            <span className="activity-label">indexing {e.notePath}</span>
            <span className="activity-count">
              {e.storedCount}/{e.total}
            </span>
            <span className="activity-elapsed">{elapsed}s</span>
            <span className="activity-bar">
              <span
                className="activity-bar-fill"
                style={{ width: `${pct}%` }}
              />
            </span>
          </div>
        );
      })}
    </div>
  );
}
