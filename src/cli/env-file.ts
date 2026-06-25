// src/cli/env-file.ts
//
// PURE .env read/merge/serialize. No filesystem, no process.env. The CLI's
// idempotent init relies on this: merge updates never clobber an existing file —
// comments, blank lines, unknown keys, and ordering are preserved verbatim, and
// a no-op merge reports changed=false so re-running init produces zero churn.
//
// Values are split on the FIRST "=" so tokens containing "=" survive intact
// (mirrors the `cut -d= -f2-` behavior of the old bash installer).

export interface EnvLine {
  /** Original line text (newline stripped). */
  raw: string;
  /** Key if this line is KEY=VALUE, else null (comment / blank / malformed). */
  key: string | null;
  /** Raw value (everything after the first "="), else null. Not trimmed. */
  value: string | null;
}

const PAIR_RE = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/;

/** Parse .env text into a line model that preserves every line verbatim. */
export function parseEnv(text: string): EnvLine[] {
  if (text === "") return [];
  // Normalize CRLF -> LF on read; serialize emits LF. A trailing newline shows
  // up as a final "" element and is faithfully restored by serializeEnv.
  const lines = text.split(/\r?\n/);
  return lines.map((raw) => {
    const trimmedStart = raw.trimStart();
    if (trimmedStart.startsWith("#") || trimmedStart === "") {
      return { raw, key: null, value: null };
    }
    const m = raw.match(PAIR_RE);
    if (!m) return { raw, key: null, value: null };
    return { raw, key: m[1], value: m[2] };
  });
}

/** First value for `key`, or undefined. */
export function getEnv(lines: EnvLine[], key: string): string | undefined {
  for (const l of lines) {
    if (l.key === key) return l.value ?? "";
  }
  return undefined;
}

export interface MergeResult {
  lines: EnvLine[];
  text: string;
  changed: boolean;
  added: string[];
  updated: string[];
}

/**
 * Merge `updates` into the existing lines. Existing keys are updated in place
 * (preserving their position); new keys are appended in insertion order.
 * `changed` is true iff any value actually differs or a key is added.
 */
export function mergeEnv(
  existing: EnvLine[],
  updates: Record<string, string>,
): MergeResult {
  const lines = existing.map((l) => ({ ...l }));
  const added: string[] = [];
  const updated: string[] = [];

  for (const [key, value] of Object.entries(updates)) {
    const idx = lines.findIndex((l) => l.key === key);
    if (idx === -1) {
      lines.push({ raw: `${key}=${value}`, key, value });
      added.push(key);
    } else if (lines[idx].value !== value) {
      lines[idx] = { raw: `${key}=${value}`, key, value };
      updated.push(key);
    }
  }

  return {
    lines,
    text: serializeEnv(lines),
    changed: added.length > 0 || updated.length > 0,
    added,
    updated,
  };
}

/** Comment out the first occurrence of `key` (used to neutralize a stray
 *  NODE_ENV=production copied from .env.example in native mode). No-op if
 *  the key is absent or already commented. */
export function commentOut(lines: EnvLine[], key: string): { lines: EnvLine[]; changed: boolean } {
  const out = lines.map((l) => ({ ...l }));
  const idx = out.findIndex((l) => l.key === key);
  if (idx === -1) return { lines: out, changed: false };
  out[idx] = { raw: `# ${out[idx].raw}`, key: null, value: null };
  return { lines: out, changed: true };
}

/** Serialize the line model back to text (LF line endings). Round-trips:
 *  serializeEnv(parseEnv(t)) === t for LF-normalized t. */
export function serializeEnv(lines: EnvLine[]): string {
  return lines.map((l) => l.raw).join("\n");
}
