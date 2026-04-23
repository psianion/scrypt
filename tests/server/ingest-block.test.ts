import { test, expect } from "bun:test";
import {
  validateIngestBlock,
  INGEST_VERSION,
} from "../../src/server/ingest/ingest-block";

test("accepts a fully populated block", () => {
  const r = validateIngestBlock({
    original_filename: "source.md",
    original_path: "/abs/source.md",
    source_hash: "sha256:abc123",
    source_size: 1024,
    source_mtime: "2026-04-16T09:12:00Z",
    tokens: 1800,
    cost_usd: 0.009,
    model: "claude-opus-4-7",
    ingested_at: "2026-04-22T14:33:00Z",
    ingest_version: INGEST_VERSION,
  });
  expect(r.ok).toBe(true);
});

test("accepts block with null LLM fields (batch_ingest case)", () => {
  const r = validateIngestBlock({
    original_filename: "x.md",
    original_path: "/abs/x.md",
    source_hash: "sha256:ff",
    source_size: 1,
    source_mtime: "2026-04-22T00:00:00Z",
    tokens: null,
    cost_usd: null,
    model: null,
    ingested_at: "2026-04-22T00:00:00Z",
    ingest_version: 1,
  });
  expect(r.ok).toBe(true);
});

test("rejects missing required field", () => {
  const r = validateIngestBlock({ original_filename: "x.md" });
  expect(r.ok).toBe(false);
});

test("rejects source_hash without algorithm prefix", () => {
  const r = validateIngestBlock({
    original_filename: "x.md",
    original_path: "/x.md",
    source_hash: "rawhexwithoutprefix",
    source_size: 1,
    source_mtime: "2026-04-22T00:00:00Z",
    ingested_at: "2026-04-22T00:00:00Z",
    ingest_version: 1,
  });
  expect(r.ok).toBe(false);
});

test("rejects negative source_size", () => {
  const base = {
    original_filename: "x.md",
    original_path: "/x.md",
    source_hash: "sha256:f",
    source_mtime: "2026-04-22T00:00:00Z",
    ingested_at: "2026-04-22T00:00:00Z",
    ingest_version: 1,
  };
  const r = validateIngestBlock({ ...base, source_size: -1 });
  expect(r.ok).toBe(false);
});
