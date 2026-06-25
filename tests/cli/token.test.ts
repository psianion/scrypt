import { describe, test, expect } from "bun:test";
import { generateToken, redactToken, isWeakToken } from "../../src/cli/token";

describe("token generation", () => {
  test("64 hex chars, no +/= chars, deterministic under injected rng", () => {
    const fakeRng = (n: number) => new Uint8Array(n).fill(0xab);
    const t = generateToken(fakeRng);
    expect(t).toBe("ab".repeat(32));
    expect(t.length).toBe(64);
    expect(/^[0-9a-f]+$/.test(t)).toBe(true);
  });

  test("varies with rng bytes", () => {
    const t = generateToken((n) => new Uint8Array(n).map((_, i) => i));
    expect(t.slice(0, 6)).toBe("000102");
  });
});

describe("redactToken", () => {
  test("masks all but last 6", () => {
    expect(redactToken("abcdef1234567890")).toBe("****567890");
  });
  test("handles missing/short", () => {
    expect(redactToken(undefined)).toBe("(none)");
    expect(redactToken("abc")).toBe("****");
  });
});

describe("isWeakToken", () => {
  test("flags absent, placeholder, short, low-entropy", () => {
    expect(isWeakToken(undefined)).toBe(true);
    expect(isWeakToken("change-me")).toBe(true);
    expect(isWeakToken("short")).toBe(true);
    expect(isWeakToken("a".repeat(64))).toBe(true);
  });
  test("accepts a real 64-hex token", () => {
    expect(isWeakToken("0123456789abcdef".repeat(4))).toBe(false);
  });
});
