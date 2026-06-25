// src/cli/health.ts
//
// Liveness probing against GET /health (the only endpoint outside the auth gate;
// returns {ok:true}). classifyHealth is pure; waitForHealth polls with injected
// probe + clock so timeout behavior is testable without real sleeps.

export interface ProbeResponse {
  status: number;
  body: string;
}

/** True iff the response is a healthy /health reply (200 + {ok:true}). */
export function classifyHealth(res: ProbeResponse | null): boolean {
  if (!res || res.status !== 200) return false;
  try {
    const j = JSON.parse(res.body) as { ok?: unknown };
    return j?.ok === true;
  } catch {
    return false;
  }
}

export interface WaitForHealthOpts {
  /** Performs one probe; should resolve even on network error (return null). */
  probe: () => Promise<ProbeResponse | null>;
  timeoutMs: number;
  intervalMs: number;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
}

/** Poll `probe` until healthy or the deadline passes. Returns whether healthy. */
export async function waitForHealth(opts: WaitForHealthOpts): Promise<boolean> {
  const deadline = opts.now() + opts.timeoutMs;
  // Always attempt at least once.
  for (;;) {
    let res: ProbeResponse | null = null;
    try {
      res = await opts.probe();
    } catch {
      res = null;
    }
    if (classifyHealth(res)) return true;
    if (opts.now() >= deadline) return false;
    await opts.sleep(opts.intervalMs);
  }
}
