export const INGEST_VERSION = 1;

export interface IngestBlock {
  original_filename: string;
  original_path: string;
  source_hash: string; // "sha256:<hex>"
  source_size: number; // bytes
  source_mtime: string; // ISO 8601
  tokens: number | null;
  cost_usd: number | null;
  model: string | null;
  ingested_at: string; // ISO 8601
  ingest_version: number;
}

export interface IngestValidation {
  ok: boolean;
  reason?: string;
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const HASH_RE = /^(sha256|sha1|blake3):[a-f0-9]+$/;

export function validateIngestBlock(obj: unknown): IngestValidation {
  if (!obj || typeof obj !== "object")
    return { ok: false, reason: "not an object" };
  const o = obj as Record<string, unknown>;

  const requireStr = (k: string) =>
    typeof o[k] !== "string" ? `${k} must be a string` : null;
  const requireNum = (k: string) =>
    typeof o[k] !== "number" ? `${k} must be a number` : null;

  for (const err of [
    requireStr("original_filename"),
    requireStr("original_path"),
    requireStr("source_hash"),
    requireNum("source_size"),
    requireStr("source_mtime"),
    requireStr("ingested_at"),
    requireNum("ingest_version"),
  ]) {
    if (err) return { ok: false, reason: err };
  }

  if ((o.source_size as number) < 0)
    return { ok: false, reason: "source_size must be ≥ 0" };
  if (!HASH_RE.test(o.source_hash as string))
    return { ok: false, reason: "source_hash must be '<algo>:<hex>'" };
  if (!ISO_RE.test(o.source_mtime as string))
    return { ok: false, reason: "source_mtime must be ISO 8601 UTC" };
  if (!ISO_RE.test(o.ingested_at as string))
    return { ok: false, reason: "ingested_at must be ISO 8601 UTC" };

  // Optional nullable fields — must be present (null or the right type).
  for (const k of ["tokens", "cost_usd", "model"] as const) {
    if (o[k] === undefined)
      return {
        ok: false,
        reason: `${k} must be present (use null if unknown)`,
      };
    if (o[k] !== null) {
      if (k === "model" && typeof o[k] !== "string") {
        return { ok: false, reason: "model must be string or null" };
      }
      if ((k === "tokens" || k === "cost_usd") && typeof o[k] !== "number") {
        return { ok: false, reason: `${k} must be number or null` };
      }
    }
  }

  return { ok: true };
}
