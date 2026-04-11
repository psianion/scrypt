// src/client/store.ts — minimal stub for Task 12, full implementation in Task 13
import { create } from "zustand";

interface AppState {
  commandPaletteOpen: boolean;
  toggleCommandPalette: () => void;
}

export const useStore = create<AppState>((set) => ({
  commandPaletteOpen: false,
  toggleCommandPalette: () => set((s) => ({ commandPaletteOpen: !s.commandPaletteOpen })),
}));
