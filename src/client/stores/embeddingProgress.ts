// src/client/stores/embeddingProgress.ts
//
// Zustand slice for the live embedding animation surfaces. Populated
// by the vault:embedding WebSocket bridge; consumed by ActivityStrip,
// the editor overlay, and the graph view.
import { create } from "zustand";

interface EmbeddingEvent {
  type: "embedding_progress";
  correlation_id: string;
  note_path: string;
  phase: "parsing" | "chunking" | "embedding" | "stored" | "done" | "error";
  chunk_id?: string;
  chunk_index?: number;
  chunk_total?: number;
  chunk_range?: [number, number];
  batch_index?: number;
  batch_total?: number;
  cache_hit?: boolean;
  error?: string;
}

export interface InFlightEntry {
  notePath: string;
  total: number;
  storedCount: number;
  activeChunk: string | null;
  activeRange: [number, number] | null;
  startedAt: number;
  lastEventAt: number;
}

interface Store {
  inFlight: Record<string, InFlightEntry>;
  onEvent: (e: EmbeddingEvent) => void;
}

const DISMISS_AFTER_MS = 3000;

export const useEmbeddingProgress = create<Store>((set, get) => ({
  inFlight: {},
  onEvent: (e) => {
    const now = Date.now();
    const current = get().inFlight[e.note_path];
    if (e.phase === "parsing" || e.phase === "chunking") {
      set({
        inFlight: {
          ...get().inFlight,
          [e.note_path]: {
            notePath: e.note_path,
            total: e.chunk_total ?? current?.total ?? 0,
            storedCount: current?.storedCount ?? 0,
            activeChunk: null,
            activeRange: null,
            startedAt: current?.startedAt ?? now,
            lastEventAt: now,
          },
        },
      });
      return;
    }
    if (!current) return;
    if (e.phase === "embedding") {
      set({
        inFlight: {
          ...get().inFlight,
          [e.note_path]: {
            ...current,
            activeChunk: e.chunk_id ?? null,
            activeRange: e.chunk_range ?? null,
            lastEventAt: now,
          },
        },
      });
      return;
    }
    if (e.phase === "stored") {
      set({
        inFlight: {
          ...get().inFlight,
          [e.note_path]: {
            ...current,
            storedCount: current.storedCount + 1,
            lastEventAt: now,
          },
        },
      });
      return;
    }
    if (e.phase === "done" || e.phase === "error") {
      setTimeout(() => {
        const next = { ...get().inFlight };
        delete next[e.note_path];
        set({ inFlight: next });
      }, DISMISS_AFTER_MS);
    }
  },
}));
