import { create } from "zustand";
import { api } from "../api";

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
  refreshHub: () => Promise<void>;
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

  refreshHub: async () => {
    const res = await api.sync.status();
    if (!res.ok) { set({ hubReachable: false }); return; }
    set({
      hubReachable: true,
      clashes: new Set(res.clashes),
      toPull: res.toPull,
      checkedAt: res.checkedAt,
      notPushed: new Set(res.notPushed),
    });
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
