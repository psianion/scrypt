import { test, expect, describe, beforeEach } from "bun:test";
import {
  DEFAULT_TIER_FILTER,
  loadTierFilter,
  saveTierFilter,
  filterEdgesByTier,
} from "../../../src/client/graph/tierFilter";
import type { SnapshotEdge } from "../../../src/server/graph/snapshot";

function fakeStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, v),
    removeItem: (k) => void store.delete(k),
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  } as Storage;
}

describe("tierFilter", () => {
  let ls: Storage;
  beforeEach(() => {
    ls = fakeStorage();
  });

  test("default has only 'connected' enabled", () => {
    expect(DEFAULT_TIER_FILTER).toEqual({ connected: true, mentions: false, semantically_related: false });
  });

  test("loadTierFilter returns default when storage is empty", () => {
    expect(loadTierFilter(ls)).toEqual(DEFAULT_TIER_FILTER);
  });

  test("save + load round-trip", () => {
    const v = { connected: false, mentions: true, semantically_related: true };
    saveTierFilter(ls, v);
    expect(loadTierFilter(ls)).toEqual(v);
  });

  test("filterEdgesByTier keeps only enabled tiers", () => {
    const edges: SnapshotEdge[] = [
      { source: "a", target: "b", tier: "connected", reason: null },
      { source: "a", target: "c", tier: "mentions", reason: null },
      { source: "a", target: "d", tier: "semantically_related", reason: null },
    ];
    const out = filterEdgesByTier(edges, { connected: true, mentions: false, semantically_related: false });
    expect(out).toHaveLength(1);
    expect(out[0]!.target).toBe("b");
  });

  test("loadTierFilter returns defaults for malformed JSON", () => {
    ls.setItem("graph-tier-filter", "{not json");
    expect(loadTierFilter(ls)).toEqual(DEFAULT_TIER_FILTER);
  });

  test("loadTierFilter returns defaults for null JSON", () => {
    ls.setItem("graph-tier-filter", "null");
    expect(loadTierFilter(ls)).toEqual(DEFAULT_TIER_FILTER);
  });

  test("loadTierFilter returns defaults for number JSON", () => {
    ls.setItem("graph-tier-filter", "42");
    expect(loadTierFilter(ls)).toEqual(DEFAULT_TIER_FILTER);
  });

  test("loadTierFilter returns defaults for array JSON", () => {
    ls.setItem("graph-tier-filter", "[]");
    expect(loadTierFilter(ls)).toEqual(DEFAULT_TIER_FILTER);
  });

  test("loadTierFilter returns defaults when version is missing (legacy)", () => {
    ls.setItem(
      "graph-tier-filter",
      JSON.stringify({ connected: false, mentions: true, semantically_related: true }),
    );
    expect(loadTierFilter(ls)).toEqual(DEFAULT_TIER_FILTER);
  });

  test("loadTierFilter falls back per-field when a field has wrong type", () => {
    ls.setItem(
      "graph-tier-filter",
      JSON.stringify({ version: 1, connected: "yes", mentions: true, semantically_related: false }),
    );
    expect(loadTierFilter(ls)).toEqual({
      connected: true,
      mentions: true,
      semantically_related: false,
    });
  });

  test("saveTierFilter writes version: 1", () => {
    saveTierFilter(ls, { connected: false, mentions: true, semantically_related: true });
    const raw = JSON.parse(ls.getItem("graph-tier-filter")!);
    expect(raw.version).toBe(1);
    expect(raw.connected).toBe(false);
    expect(raw.mentions).toBe(true);
    expect(raw.semantically_related).toBe(true);
  });
});
