import "./ClashResolver.css";
import { useEffect, useMemo, useState } from "react";
import { api, type DiffRegion } from "../api";
import { useToastStore } from "../stores/toast";
import { useSyncStatus } from "../stores/syncStatus";
import { ConflictChunk, type Choice } from "./ConflictChunk";

export function ClashResolver({ path, onDone }: { path: string; onDone: () => void }) {
  const [regions, setRegions] = useState<DiffRegion[] | null>(null);
  const [choices, setChoices] = useState<Record<number, Choice>>({});
  const [busy, setBusy] = useState(false);
  const enqueue = useToastStore((s) => s.enqueue);
  const refreshHub = useSyncStatus((s) => s.refreshHub);

  useEffect(() => {
    api.sync.diff(path).then((r) => setRegions(r.regions)).catch(() => { enqueue({ variant: "error", title: "Could not load the clash" }); onDone(); });
  }, [path]);

  const conflictIdx = useMemo(() => (regions ?? []).map((r, i) => (r.type === "conflict" ? i : -1)).filter((i) => i >= 0), [regions]);
  const allChosen = conflictIdx.every((i) => choices[i]);

  function assemble(): string {
    return (regions ?? []).map((r, i) => {
      if (r.type === "clean") return r.text;
      const c = choices[i];
      if (c === "mine") return r.local;
      if (c === "hub") return r.remote;
      return `${r.local}\n${r.remote}`; // both: yours then hub, document order
    }).join("\n");
  }

  async function resolve() {
    setBusy(true);
    try { await api.sync.resolve(path, assemble()); enqueue({ variant: "success", title: "Clash resolved" }); await refreshHub(); onDone(); }
    catch { enqueue({ variant: "error", title: "Resolve failed", message: "The hub may be offline, or it was resolved elsewhere." }); await refreshHub(); }
    finally { setBusy(false); }
  }

  if (!regions) return <div className="clash">Loading…</div>;
  return (
    <div className="clash" data-testid="clash-resolver">
      <div className="clash__banner">⚠ Clash. This note changed here and on the hub. Pick what stays, then resolve.</div>
      <div className="clash__body">
        {regions.map((r, i) => r.type === "clean"
          ? <p key={i} className="clash__clean">{r.text}</p>
          : <ConflictChunk key={i} local={r.local} remote={r.remote} choice={choices[i] ?? null} onChoose={(c) => setChoices((p) => ({ ...p, [i]: c }))} />)}
      </div>
      <div className="clash__footer">
        <span className="clash__prog">{conflictIdx.filter((i) => choices[i]).length} of {conflictIdx.length} conflicts resolved</span>
        <span className="clash__spacer" />
        <button type="button" onClick={onDone}>Cancel</button>
        <button type="button" className="clash__primary" disabled={!allChosen || busy} onClick={resolve}>Resolve &amp; Sync</button>
      </div>
    </div>
  );
}
