// src/server/embeddings/progress.ts
//
// Structured event bus for embedding progress. The embedding service
// calls emit() at phase boundaries and emitThrottled() for per-chunk
// signals that could fire hundreds of times per second. Subscribers
// (WebSocket sink, test harnesses) are decoupled from the emitter.

export type EmbeddingPhase =
  | "parsing"
  | "chunking"
  | "embedding"
  | "stored"
  | "done"
  | "error";

export interface EmbeddingEvent {
  type: "embedding_progress";
  correlation_id: string;
  note_path: string;
  phase: EmbeddingPhase;
  chunk_id?: string;
  chunk_index?: number;
  chunk_total?: number;
  chunk_range?: [number, number];
  batch_index?: number;
  batch_total?: number;
  cache_hit?: boolean;
  error?: string;
}

type Listener = (e: EmbeddingEvent) => void;

interface ProgressBusOptions {
  coalesceMs?: number;
}

export class ProgressBus {
  private listeners = new Set<Listener>();
  private coalesceMs: number;
  private throttleTimer: ReturnType<typeof setTimeout> | null = null;
  private pending: EmbeddingEvent | null = null;
  private lastFlush = 0;

  constructor(opts: ProgressBusOptions = {}) {
    this.coalesceMs = opts.coalesceMs ?? 30;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  emit(e: EmbeddingEvent): void {
    for (const fn of this.listeners) fn(e);
  }

  emitThrottled(e: EmbeddingEvent): void {
    const now = Date.now();
    this.pending = e;
    if (now - this.lastFlush >= this.coalesceMs) {
      this.flush();
      return;
    }
    if (!this.throttleTimer) {
      this.throttleTimer = setTimeout(() => this.flush(), this.coalesceMs);
    }
  }

  private flush(): void {
    if (this.throttleTimer) {
      clearTimeout(this.throttleTimer);
      this.throttleTimer = null;
    }
    if (!this.pending) return;
    const e = this.pending;
    this.pending = null;
    this.lastFlush = Date.now();
    this.emit(e);
  }
}
