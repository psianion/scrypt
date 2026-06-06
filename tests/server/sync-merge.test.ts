import { test, expect } from "bun:test";
import { threeWayMerge } from "../../src/server/sync/merge";

test("non-overlapping edits auto-merge into clean regions only (no conflicts)", () => {
  const base = "line1\nline2\nline3";
  const local = "line1-mine\nline2\nline3";   // changed line 1
  const remote = "line1\nline2\nline3-theirs"; // changed line 3
  const regions = threeWayMerge(base, local, remote);
  expect(regions.every((r) => r.type === "clean")).toBe(true);
  const merged = regions.map((r) => (r.type === "clean" ? r.text : "")).join("\n");
  expect(merged).toContain("line1-mine");
  expect(merged).toContain("line3-theirs");
});

test("overlapping edits on the same line produce a conflict region", () => {
  const base = "the cat sat";
  const local = "the dog sat";
  const remote = "the fox sat";
  const regions = threeWayMerge(base, local, remote);
  const conflicts = regions.filter((r) => r.type === "conflict");
  expect(conflicts).toHaveLength(1);
  expect(conflicts[0]).toMatchObject({ type: "conflict", local: "the dog sat", remote: "the fox sat" });
});

test("null base falls back to a single whole-text conflict", () => {
  const regions = threeWayMerge(null, "mine", "theirs");
  expect(regions).toEqual([{ type: "conflict", local: "mine", remote: "theirs" }]);
});
