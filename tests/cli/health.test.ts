import { describe, test, expect } from "bun:test";
import { classifyHealth, waitForHealth } from "../../src/cli/health";

describe("classifyHealth", () => {
  test("200 + {ok:true} is healthy", () => {
    expect(classifyHealth({ status: 200, body: '{"ok":true}' })).toBe(true);
  });
  test("non-200, bad body, or null is unhealthy", () => {
    expect(classifyHealth({ status: 401, body: '{"ok":true}' })).toBe(false);
    expect(classifyHealth({ status: 200, body: "not json" })).toBe(false);
    expect(classifyHealth({ status: 200, body: '{"ok":false}' })).toBe(false);
    expect(classifyHealth(null)).toBe(false);
  });
});

describe("waitForHealth", () => {
  test("returns true when a mid-poll probe flips healthy", async () => {
    let calls = 0;
    let clock = 0;
    const ok = await waitForHealth({
      probe: async () => {
        calls++;
        return calls >= 3 ? { status: 200, body: '{"ok":true}' } : { status: 503, body: "" };
      },
      timeoutMs: 10_000,
      intervalMs: 100,
      now: () => clock,
      sleep: async (ms) => { clock += ms; },
    });
    expect(ok).toBe(true);
    expect(calls).toBe(3);
  });

  test("returns false on timeout (deterministic fake clock, no real sleep)", async () => {
    let clock = 0;
    const ok = await waitForHealth({
      probe: async () => ({ status: 503, body: "" }),
      timeoutMs: 500,
      intervalMs: 100,
      now: () => clock,
      sleep: async (ms) => { clock += ms; },
    });
    expect(ok).toBe(false);
  });
});
