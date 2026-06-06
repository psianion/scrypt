// tests/server/indexer/reference-links.test.ts
import { test, expect, describe } from "bun:test";
import { extractReferenceTargets } from "../../../src/server/indexer/reference-links";

describe("extractReferenceTargets", () => {
  test("internal markdown link → raw path preserved (no .md strip)", () => {
    const body = "Background in [the spec](projects/dnd/spec/world.md).";
    const out = extractReferenceTargets(body);
    expect(out).toContainEqual({ raw: "projects/dnd/spec/world.md", reason: "reference" });
  });

  test("wikilink → reference target by title", () => {
    const body = "See [[World Bible]] for the canon.";
    const out = extractReferenceTargets(body);
    expect(out).toContainEqual({ raw: "World Bible", reason: "reference" });
  });

  test("'see also' cross-ref line → reference target", () => {
    const body = "## Notes\n\nSee also: [Session 12](notes/session-12.md)";
    const out = extractReferenceTargets(body);
    expect(out).toContainEqual({ raw: "notes/session-12.md", reason: "reference" });
  });

  test("citation syntax (Refs/Sources list with link) → cites target", () => {
    const body = "## References\n\n- [Monster Manual](projects/dnd/reference/monster-manual.md)";
    const out = extractReferenceTargets(body);
    expect(out).toContainEqual({ raw: "projects/dnd/reference/monster-manual.md", reason: "cites" });
  });

  test("ignores external http links", () => {
    const body = "Read [the blog](https://example.com/post).";
    const out = extractReferenceTargets(body);
    expect(out).toHaveLength(0);
  });

  test("ignores fenced code blocks", () => {
    const body = "```md\n[fake](notes/fake.md)\n```\nreal [one](notes/real.md)";
    const out = extractReferenceTargets(body);
    expect(out.map((t) => t.raw)).toEqual(["notes/real.md"]);
  });

  test("dedupes repeated targets, first reason wins", () => {
    const body = "[A](notes/a.md) and again [A](notes/a.md)";
    const out = extractReferenceTargets(body);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({ raw: "notes/a.md", reason: "reference" });
  });

  test("ignores image embeds", () => {
    const out = extractReferenceTargets("![banner](assets/banner.png) and [real](notes/r.md)");
    expect(out.map((t) => t.raw)).toEqual(["notes/r.md"]);
  });

  test("strips in-note anchor from the target path", () => {
    const out = extractReferenceTargets("Jump to [Combat](notes/rules.md#combat).");
    expect(out).toContainEqual({ raw: "notes/rules.md", reason: "reference" });
  });
});
