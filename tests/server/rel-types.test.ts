import { test, expect } from "bun:test";
import { REL_TYPES, isRelType } from "../../src/server/vocab/rel-types";

test("REL_TYPES is the six-value vocabulary", () => {
  expect([...REL_TYPES]).toEqual([
    "builds_on",
    "replaces",
    "contradicts",
    "part_of",
    "cites",
    "relates_to",
  ]);
});

test("isRelType accepts every member and rejects junk", () => {
  for (const v of REL_TYPES) expect(isRelType(v)).toBe(true);
  expect(isRelType("semantically_related")).toBe(false);
  expect(isRelType("builds-on")).toBe(false);
  expect(isRelType(null)).toBe(false);
  expect(isRelType(42)).toBe(false);
});
