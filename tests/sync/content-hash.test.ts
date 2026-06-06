import { test, expect } from "bun:test";
import { computeContentHash } from "../../src/server/sync/content-hash";

test("computeContentHash is deterministic", () => {
  const fm = { title: "A", kind: "note" };
  expect(computeContentHash(fm, "body")).toBe(computeContentHash(fm, "body"));
});

test("computeContentHash changes when content changes", () => {
  const fm = { title: "A" };
  expect(computeContentHash(fm, "x")).not.toBe(computeContentHash(fm, "y"));
});

test("computeContentHash changes when frontmatter changes", () => {
  expect(computeContentHash({ a: 1 }, "x")).not.toBe(computeContentHash({ a: 2 }, "x"));
});

test("computeContentHash matches the indexer's raw formula", () => {
  const frontmatter = { title: "A", kind: "note" };
  const content = "hello";
  const expected = Bun.hash(`${JSON.stringify(frontmatter)}${content}`).toString(16);
  expect(computeContentHash(frontmatter, content)).toBe(expected);
});
