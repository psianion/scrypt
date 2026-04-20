import type { Database } from "bun:sqlite";
import { writeGraphSnapshot } from "./snapshot";

export type SnapshotWriter = (db: Database, vaultDir: string) => unknown | Promise<unknown>;

export interface SchedulerOpts {
  debounceMs?: number;
  writer?: SnapshotWriter;
  maxConsecutiveFailures?: number;
}

export class SnapshotScheduler {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private pendingAfterCurrent = false;
  private readonly debounceMs: number;
  private readonly writer: SnapshotWriter;
  private readonly maxConsecutiveFailures: number;
  private consecutiveFailures = 0;
  private _lastError: Error | null = null;
  private _disabled = false;

  buildCount = 0;

  constructor(
    private db: Database,
    private vaultDir: string,
    opts: SchedulerOpts = {},
  ) {
    this.debounceMs = opts.debounceMs ?? 2000;
    this.writer = opts.writer ?? writeGraphSnapshot;
    this.maxConsecutiveFailures = opts.maxConsecutiveFailures ?? 5;
  }

  get lastError(): Error | null {
    return this._lastError;
  }

  get disabled(): boolean {
    return this._disabled;
  }

  // Coalesces repeated calls within the debounce window.
  schedule(): void {
    if (this._disabled) return;
    if (this.running) {
      this.pendingAfterCurrent = true;
      return;
    }
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, this.debounceMs);
  }

  // Re-enables the scheduler so callers can recover from disabled state.
  async flushNow(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this._disabled = false;
    await this.flush();
  }

  private async flush(): Promise<void> {
    if (this.running) {
      this.pendingAfterCurrent = true;
      return;
    }
    this.running = true;
    try {
      await this.writer(this.db, this.vaultDir);
      this.buildCount += 1;
      this.consecutiveFailures = 0;
      this._lastError = null;
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      this._lastError = e;
      this.consecutiveFailures += 1;
      console.error("[scrypt] snapshot write failed", {
        vaultDir: this.vaultDir,
        consecutiveFailures: this.consecutiveFailures,
        errorMessage: e.message,
        errorStack: e.stack,
      });
      if (this.consecutiveFailures >= this.maxConsecutiveFailures) {
        this._disabled = true;
      }
    } finally {
      this.running = false;
      const shouldChain = this.pendingAfterCurrent && !this._disabled;
      this.pendingAfterCurrent = false;
      if (shouldChain) this.schedule();
    }
  }
}
