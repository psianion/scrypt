import { create } from "zustand";
import { api } from "../api";
import { useToastStore } from "./toast";

export type DotState = "clash" | "not_pushed" | "in_sync";

export function syncDotState(path: string, notPushed: Set<string>, clashes: Set<string>): DotState {
  if (clashes.has(path)) return "clash";
  if (notPushed.has(path)) return "not_pushed";
  return "in_sync";
}

interface SyncStatusStore {
  notPushed: Set<string>;
  clashes: Set<string>;
  toPull: { path: string; reason: string }[];
  hubReachable: boolean;
  checkedAt: number | null;
  syncing: boolean;
  refreshLocal: () => Promise<void>;
  refreshHub: (opts?: { interactive?: boolean }) => Promise<void>;
  runSync: () => Promise<void>;
}

export const useSyncStatus = create<SyncStatusStore>((set, get) => ({
  notPushed: new Set(),
  clashes: new Set(),
  toPull: [],
  hubReachable: true,
  checkedAt: null,
  syncing: false,

  refreshLocal: async () => {
    try {
      const { notPushed } = await api.sync.localStatus();
      set({ notPushed: new Set(notPushed) });
    } catch { /* local-status never needs the hub; ignore transient errors */ }
  },

  refreshHub: async (opts) => {
    // A thrown 500/network error from /api/sync/status (api.json throws on
    // non-2xx) used to be an unhandled rejection that left stale state with no
    // signal. Catch it, mark the hub unreachable, and surface a toast when the
    // user triggered the check themselves. (F10)
    try {
      const res = await api.sync.status();
      if (!res.ok) {
        set({ hubReachable: false });
        if (opts?.interactive) useToastStore.getState().enqueue({ variant: "warn", title: "Hub offline", message: "Couldn't reach the sync hub." });
        return;
      }
      // Coerce every field to its store invariant. A 2xx body from the real hub
      // always carries these, but a partial/malformed payload must never write
      // `undefined` into `toPull` — the SyncBar reads `toPull.length` on every
      // render and would otherwise crash the whole sidebar. (F10)
      set({
        hubReachable: true,
        clashes: new Set(res.clashes ?? []),
        toPull: Array.isArray(res.toPull) ? res.toPull : [],
        checkedAt: res.checkedAt ?? null,
        notPushed: new Set(res.notPushed ?? []),
      });
    } catch {
      set({ hubReachable: false });
      if (opts?.interactive) useToastStore.getState().enqueue({ variant: "error", title: "Hub check failed", message: "The sync hub returned an error." });
    }
  },

  runSync: async () => {
    set({ syncing: true });
    try { await api.sync.sync(); } finally {
      set({ syncing: false });
      await get().refreshLocal();
      await get().refreshHub();
    }
  },
}));
