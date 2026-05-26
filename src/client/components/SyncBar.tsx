import "./SyncBar.css";
import { RotateCw } from "lucide-react";
import { useSyncStatus } from "../stores/syncStatus";

function ago(ts: number | null): string {
  if (!ts) return "not checked";
  const m = Math.round((Date.now() - ts) / 60000);
  return m <= 0 ? "just now" : `${m}m ago`;
}

export function SyncBar() {
  const push = useSyncStatus((s) => s.notPushed.size);
  const pull = useSyncStatus((s) => s.toPull.length);
  const clash = useSyncStatus((s) => s.clashes.size);
  const hubReachable = useSyncStatus((s) => s.hubReachable);
  const checkedAt = useSyncStatus((s) => s.checkedAt);
  const syncing = useSyncStatus((s) => s.syncing);
  const runSync = useSyncStatus((s) => s.runSync);
  const refreshHub = useSyncStatus((s) => s.refreshHub);

  const parts: string[] = [];
  if (push) parts.push(`${push} to push`);
  if (hubReachable) {
    if (pull) parts.push(`${pull} to pull`);
    if (clash) parts.push(`${clash} clash`);
  }

  return (
    <div className="sync-bar" data-testid="sync-bar">
      <div className="sync-bar__counts">
        {push > 0 && <span className="sync-bar__push">{push} to push</span>}
        {hubReachable && pull > 0 && <span className="sync-bar__pull">{pull} to pull</span>}
        {hubReachable && clash > 0 && <span className="sync-bar__clash">{clash} clash</span>}
        {parts.length === 0 && <span className="sync-bar__synced">In sync</span>}
      </div>
      <div className="sync-bar__actions">
        <button type="button" className="sync-bar__sync" disabled={syncing} onClick={() => runSync()} aria-label="Sync">
          <RotateCw size={13} strokeWidth={1.75} aria-hidden="true" /> {syncing ? "Syncing…" : "Sync"}
        </button>
        <button type="button" className="sync-bar__refresh" onClick={() => refreshHub()} title="Check hub" aria-label="Check hub">⟳</button>
      </div>
      <div className="sync-bar__last">{hubReachable ? `hub checked ${ago(checkedAt)}` : "hub offline"}</div>
    </div>
  );
}
