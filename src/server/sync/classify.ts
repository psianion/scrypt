// src/server/sync/classify.ts
//
// Pure decision logic for sync. Compares each note's local hash, hub
// (remote) hash, and the last-synced base hash, and decides the action.
export type SyncReason =
  | "in_sync"
  | "push_new"
  | "push_update"
  | "pull_new"
  | "pull_update"
  | "clash"
  | "removed_on_hub"
  | "removed_locally";

export interface SyncItem {
  path: string;
  reason: SyncReason;
}

export interface SyncPlan {
  toPush: SyncItem[];
  toPull: SyncItem[];
  clashes: SyncItem[];
  skipped: SyncItem[];
  inSync: SyncItem[];
}

export function classify(
  local: Map<string, string>,
  remote: Map<string, string>,
  base: Map<string, string>,
): SyncPlan {
  const plan: SyncPlan = {
    toPush: [],
    toPull: [],
    clashes: [],
    skipped: [],
    inSync: [],
  };
  const paths = new Set<string>([...local.keys(), ...remote.keys()]);
  for (const path of [...paths].sort()) {
    const l = local.get(path);
    const r = remote.get(path);
    const b = base.get(path);

    if (l !== undefined && r !== undefined) {
      if (l === r) {
        plan.inSync.push({ path, reason: "in_sync" });
        continue;
      }
      if (b === undefined) {
        plan.clashes.push({ path, reason: "clash" });
        continue;
      }
      const localChanged = l !== b;
      const remoteChanged = r !== b;
      // l !== r is guaranteed here (the l === r case returned above), so at
      // least one side differs from base — the "neither changed" case cannot occur.
      if (localChanged && remoteChanged) plan.clashes.push({ path, reason: "clash" });
      else if (localChanged) plan.toPush.push({ path, reason: "push_update" });
      else plan.toPull.push({ path, reason: "pull_update" });
      continue;
    }

    if (l !== undefined) {
      // local only
      if (b === undefined) plan.toPush.push({ path, reason: "push_new" });
      else plan.skipped.push({ path, reason: "removed_on_hub" });
      continue;
    }

    // remote only
    if (b === undefined) plan.toPull.push({ path, reason: "pull_new" });
    // Deleted locally but the hub has since changed it (r !== b): a genuine
    // upstream update must be able to resurrect the note, otherwise it stays
    // skipped forever. Only treat it as a settled local delete when the hub
    // copy still matches our base (nothing new upstream).
    else if (r !== b) plan.toPull.push({ path, reason: "pull_new" });
    else plan.skipped.push({ path, reason: "removed_locally" });
  }
  return plan;
}
