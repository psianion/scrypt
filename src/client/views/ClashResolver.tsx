import "./ClashResolver.css";
import { useEffect, useMemo, useState } from "react";
import { api, type DiffRegion } from "../api";
import { useToastStore } from "../stores/toast";
import { useSyncStatus } from "../stores/syncStatus";
import { ConflictChunk, type Choice } from "./ConflictChunk";

type LoadError = "offline" | "load_failed";

export function ClashResolver({ path, onDone }: { path: string; onDone: () => void }) {
  const [regions, setRegions] = useState<DiffRegion[] | null>(null);
  const [loadError, setLoadError] = useState<LoadError | null>(null);
  const [choices, setChoices] = useState<Record<number, Choice>>({});
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const enqueue = useToastStore((s) => s.enqueue);
  const refreshHub = useSyncStatus((s) => s.refreshHub);

  useEffect(() => {
    let live = true;
    setRegions(null);
    setLoadError(null);
    // Inspect status/body explicitly instead of api.sync.diff() so we can tell
    // apart: 409 no_diff (already resolved elsewhere — good news), an HTTP-200
    // {ok:false,error:'hub_unreachable'} (offline; would otherwise hang on
    // "Loading…" forever), and a genuine diff payload. (F11)
    (async () => {
      try {
        const res = await fetch(`/api/sync/diff?path=${encodeURIComponent(path)}`);
        if (res.status === 409) {
          if (!live) return;
          enqueue({ variant: "success", title: "Already resolved", message: "This note is back in sync with the hub." });
          await refreshHub();
          onDone();
          return;
        }
        const body = await res.json().catch(() => null) as { regions?: DiffRegion[]; ok?: boolean; error?: string } | null;
        if (!live) return;
        if (!res.ok || !body || body.ok === false || !Array.isArray(body.regions)) {
          setLoadError(body?.error === "hub_unreachable" ? "offline" : "load_failed");
          return;
        }
        setRegions(body.regions);
      } catch {
        if (live) setLoadError("load_failed");
      }
    })();
    return () => { live = false; };
  }, [path]);

  const conflictIdx = useMemo(() => (regions ?? []).map((r, i) => (r.type === "conflict" ? i : -1)).filter((i) => i >= 0), [regions]);
  const autoMergeable = regions !== null && conflictIdx.length === 0;
  const allChosen = conflictIdx.every((i) => choices[i]);
  // When every region auto-merged, there is nothing to pick — but we must not
  // let the user blind-commit a machine merge. Gate the CTA on an explicit
  // "Accept auto-merge" confirmation instead. (F9)
  const canResolve = autoMergeable ? accepted : allChosen;

  function assemble(): string {
    return (regions ?? []).map((r, i) => {
      if (r.type === "clean") return r.text;
      const c = choices[i];
      if (c === "mine") return r.local;
      if (c === "hub") return r.remote;
      // "Keep both": yours first, then hub, in document order.
      return `${r.local}\n${r.remote}`;
    })
      // Drop empty chosen sides (a deletion) so the outer join does not inject a
      // phantom blank line into the document pushed to the hub. (F8)
      .filter((s) => s !== "")
      .join("\n");
  }

  async function resolve() {
    setBusy(true);
    try { await api.sync.resolve(path, assemble()); enqueue({ variant: "success", title: "Clash resolved" }); await refreshHub(); onDone(); }
    catch { enqueue({ variant: "error", title: "Resolve failed", message: "The hub may be offline, or it was resolved elsewhere." }); await refreshHub(); }
    finally { setBusy(false); }
  }

  if (loadError) {
    return (
      <div className="clash" data-testid="clash-resolver">
        <div className="clash__banner">
          {loadError === "offline"
            ? "Hub offline — can't resolve this clash right now."
            : "Couldn't load the clash. Try again once the hub is reachable."}
        </div>
        <div className="clash__footer">
          <span className="clash__spacer" />
          <button type="button" className="clash__primary" onClick={onDone}>Back to editor</button>
        </div>
      </div>
    );
  }

  if (!regions) return <div className="clash">Loading…</div>;
  return (
    <div className="clash" data-testid="clash-resolver">
      <div className="clash__banner">
        {autoMergeable
          ? "⚠ This note changed here and on the hub, but the edits don't overlap. Review the auto-merge below, then accept it."
          : "⚠ Clash. This note changed here and on the hub. Pick what stays, then resolve."}
      </div>
      <div className="clash__body">
        {autoMergeable && (
          <p className="clash__automerge-note">No overlapping edits — every change below is kept automatically.</p>
        )}
        {regions.map((r, i) => r.type === "clean"
          ? <p key={i} className="clash__clean">{r.text}</p>
          : <ConflictChunk key={i} index={conflictIdx.indexOf(i) + 1} local={r.local} remote={r.remote} choice={choices[i] ?? null} onChoose={(c) => setChoices((p) => ({ ...p, [i]: c }))} />)}
        {autoMergeable && (
          <label className="clash__accept">
            <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />
            I've reviewed the auto-merge above.
          </label>
        )}
      </div>
      <div className="clash__footer">
        <span className="clash__prog" role="status" aria-live="polite">
          {autoMergeable
            ? "No conflicts — auto-merge ready for review"
            : `${conflictIdx.filter((i) => choices[i]).length} of ${conflictIdx.length} conflicts resolved`}
        </span>
        <span className="clash__spacer" />
        <button type="button" onClick={onDone}>Cancel</button>
        <button type="button" className="clash__primary" disabled={!canResolve || busy} onClick={resolve}>
          {autoMergeable ? "Accept auto-merge" : "Resolve & Sync"}
        </button>
      </div>
    </div>
  );
}
