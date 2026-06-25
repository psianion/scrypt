// src/cli/token.ts
//
// PURE token helpers. Randomness is injected (node:crypto's randomBytes in the
// real ctx) so generation is deterministic under test. 32 bytes -> 64 hex chars,
// matching the `.env.example` `openssl rand -hex 32` convention and avoiding any
// +/= characters that would complicate shell-quoting or .env parsing.

export type RandomBytes = (size: number) => Uint8Array;

export function generateToken(randomBytes: RandomBytes): string {
  const buf = randomBytes(32);
  let hex = "";
  for (const b of buf) hex += b.toString(16).padStart(2, "0");
  return hex;
}

/** Mask a token for display: "****" + last 6 chars. */
export function redactToken(t: string | undefined): string {
  if (!t) return "(none)";
  if (t.length <= 6) return "****";
  return "****" + t.slice(-6);
}

/** A token is weak if absent, the placeholder, too short, or single-char. */
export function isWeakToken(t: string | undefined): boolean {
  if (!t) return true;
  if (t === "change-me") return true;
  if (t.length < 32) return true;
  if (new Set(t).size <= 2) return true; // e.g. "aaaa…", trivially low entropy
  return false;
}
