//
// Main-thread proxy for the embed worker. Implements EmbedderLike so it
// drops into ToolContext.embedService unchanged from the consumer's
// perspective. Owns:
//   - Worker lifecycle (lazy spawn, restart on hard error)
//   - In-flight request map with 60s per-request timeout
//   - Circuit breaker: 3 restarts in 30s opens for 5 min
//   - Progress event forwarding from worker → parent ProgressBus
//   - Health counters exposed via getStats() for /api/health/embed

import { randomUUID } from "node:crypto";
import type {
  WorkerInbound,
  WorkerOutbound,
  EmbedJobMessage,
} from "./worker-protocol";
import type { EmbedderLike, EmbedResult } from "./service";
import type { ProgressBus } from "./progress";
import type { ParsedStructural } from "../indexer/structural-parse";

export interface WorkerLike {
  postMessage(msg: WorkerInbound): void;
  on(event: "message", cb: (m: WorkerOutbound) => void): void;
  on(event: "error", cb: (e: Error) => void): void;
  on(event: "exit", cb: (code: number) => void): void;
  terminate(): Promise<number> | number;
}

export interface EmbedClientOptions {
  spawn: () => WorkerLike;
  bus: ProgressBus;
  requestTimeoutMs?: number;
  breakerThreshold?: number;
  breakerWindowMs?: number;
  breakerCooldownMs?: number;
}

interface PendingRequest {
  resolve: (r: EmbedResult) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface ClientStats {
  queueDepth: number;
  skippedTotal: number;
  timeoutsTotal: number;
  restartsTotal: number;
  circuitState: "closed" | "open";
}

export class EmbedClient implements EmbedderLike {
  private worker: WorkerLike | null = null;
  private workerReady = false;
  private pendingOutbound: EmbedJobMessage[] = [];
  private inflight = new Map<string, PendingRequest>();
  private restartTimestamps: number[] = [];
  private circuitOpenedAt = 0;
  private stats: ClientStats = {
    queueDepth: 0,
    skippedTotal: 0,
    timeoutsTotal: 0,
    restartsTotal: 0,
    circuitState: "closed",
  };

  constructor(private opts: EmbedClientOptions) {}

  async embedNote(
    parsed: ParsedStructural,
    correlationId: string,
  ): Promise<EmbedResult> {
    if (this.isCircuitOpen()) {
      throw new Error("embed worker unavailable (circuit open)");
    }
    const worker = this.ensureWorker();
    const requestId = randomUUID();
    const timeoutMs = this.opts.requestTimeoutMs ?? 60_000;

    return new Promise<EmbedResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        const pending = this.inflight.get(requestId);
        if (!pending) return;
        this.inflight.delete(requestId);
        this.stats.queueDepth = this.inflight.size;
        this.stats.timeoutsTotal += 1;
        pending.reject(new Error(`embed timeout for request ${requestId}`));
      }, timeoutMs);

      this.inflight.set(requestId, { resolve, reject, timer });
      this.stats.queueDepth = this.inflight.size;

      const msg: EmbedJobMessage = {
        type: "embed-note",
        requestId,
        parsed,
        correlationId,
      };
      if (this.workerReady) {
        worker.postMessage(msg);
      } else {
        // Worker is still bootstrapping (loading the model). node:worker_threads
        // drops messages sent before the worker attaches its parentPort listener,
        // so we buffer here and flush when the worker-ready handshake arrives.
        this.pendingOutbound.push(msg);
      }
    });
  }

  getStats(): ClientStats {
    return { ...this.stats };
  }

  shutdown(): void {
    if (this.worker) {
      try {
        this.worker.postMessage({ type: "shutdown" });
        this.worker.terminate();
      } catch {}
      this.worker = null;
    }
  }

  // ---- lifecycle ----

  private ensureWorker(): WorkerLike {
    if (this.worker) return this.worker;
    const w = this.opts.spawn();
    this.attach(w);
    this.worker = w;
    return w;
  }

  private attach(w: WorkerLike): void {
    w.on("message", (msg) => this.onMessage(msg));
    w.on("error", (err) => this.onWorkerError(err));
    w.on("exit", (code) => {
      if (code !== 0) this.onWorkerError(new Error(`worker exited code=${code}`));
    });
  }

  private onMessage(msg: WorkerOutbound): void {
    switch (msg.type) {
      case "embed-done": {
        const pending = this.inflight.get(msg.requestId);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.inflight.delete(msg.requestId);
        this.stats.queueDepth = this.inflight.size;
        this.stats.skippedTotal += msg.chunksSkipped;
        pending.resolve({
          chunks_total: msg.chunksTotal,
          chunks_embedded: msg.chunksEmbedded,
          embed_ms: msg.embedMs,
        });
        return;
      }
      case "worker-error": {
        if (msg.requestId) {
          const pending = this.inflight.get(msg.requestId);
          if (pending) {
            clearTimeout(pending.timer);
            this.inflight.delete(msg.requestId);
            this.stats.queueDepth = this.inflight.size;
            pending.reject(new Error(msg.message));
          }
        } else {
          this.onWorkerError(new Error(msg.message));
        }
        return;
      }
      case "embed-progress": {
        this.opts.bus.emit(msg.event);
        return;
      }
      case "worker-ready": {
        this.workerReady = true;
        if (this.worker) {
          const worker = this.worker;
          const queued = this.pendingOutbound;
          this.pendingOutbound = [];
          for (const m of queued) worker.postMessage(m);
        }
        return;
      }
    }
  }

  private onWorkerError(err: Error): void {
    for (const [, pending] of this.inflight) {
      clearTimeout(pending.timer);
      pending.reject(err);
    }
    this.inflight.clear();
    this.stats.queueDepth = 0;
    if (this.worker) {
      try {
        this.worker.terminate();
      } catch {}
    }
    this.worker = null;
    this.workerReady = false;
    this.pendingOutbound = [];
    this.recordRestart();
  }

  private recordRestart(): void {
    const now = Date.now();
    const window = this.opts.breakerWindowMs ?? 30_000;
    this.restartTimestamps = this.restartTimestamps.filter(
      (t) => now - t < window,
    );
    this.restartTimestamps.push(now);
    this.stats.restartsTotal += 1;
    const threshold = this.opts.breakerThreshold ?? 3;
    if (this.restartTimestamps.length >= threshold) {
      this.circuitOpenedAt = now;
      this.stats.circuitState = "open";
    }
  }

  private isCircuitOpen(): boolean {
    if (this.stats.circuitState !== "open") return false;
    const cooldown = this.opts.breakerCooldownMs ?? 5 * 60_000;
    if (Date.now() - this.circuitOpenedAt > cooldown) {
      this.stats.circuitState = "closed";
      this.restartTimestamps = [];
      return false;
    }
    return true;
  }
}
