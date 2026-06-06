import "./SyncDot.css";
import type { DotState } from "../stores/syncStatus";

export function SyncDot({ state }: { state: DotState }) {
  if (state === "in_sync") return <span className="sync-dot sync-dot--placeholder" aria-hidden="true" />;
  const label = state === "clash" ? "Clash" : "Not pushed";
  return <span className={`sync-dot sync-dot--${state}`} title={label} role="img" aria-label={label} />;
}
