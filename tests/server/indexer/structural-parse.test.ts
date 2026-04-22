// tests/server/indexer/structural-parse.test.ts
import { test, expect, describe } from "bun:test";
import { parseStructural } from "../../../src/server/indexer/structural-parse";

const SAMPLE = `---
title: Actor-Critic Methods
tags: [ml, rl]
---

Intro paragraph with a #topic/rl tag.

## Policy Gradients

Body of the policy gradients section.

## Advantage Estimation

More content here.
`;

describe("parseStructural", () => {
  test("parses frontmatter", () => {
    const r = parseStructural("research/actor-critic.md", SAMPLE);
    expect(r.frontmatter.title).toBe("Actor-Critic Methods");
    expect(r.frontmatter.tags).toEqual(["ml", "rl"]);
  });

  test("extracts inline tags", () => {
    const r = parseStructural("research/actor-critic.md", SAMPLE);
    expect(r.tags).toContain("topic/rl");
  });

  test("splits into sections including intro", () => {
    const r = parseStructural("research/actor-critic.md", SAMPLE);
    expect(r.sections.length).toBe(3);
    expect(r.sections[0].headingSlug).toBe("h-intro-0");
    expect(r.sections[1].headingSlug).toBe("policy-gradients");
    expect(r.sections[2].headingSlug).toBe("advantage-estimation");
    expect(r.sections[1].level).toBe(2);
    expect(r.sections[1].endLine).toBeGreaterThan(r.sections[1].startLine);
  });

  test("computes content hash of body without frontmatter", () => {
    const r1 = parseStructural("a.md", SAMPLE);
    const r2 = parseStructural("a.md", SAMPLE);
    expect(r1.contentHash).toBe(r2.contentHash);
    expect(r1.contentHash).toHaveLength(64);
  });

  test("section slugs disambiguate duplicates", () => {
    const dup = `## Notes\n\nfoo\n\n## Notes\n\nbar\n`;
    const r = parseStructural("x.md", dup);
    const slugs = r.sections.map((s) => s.headingSlug);
    expect(slugs).toContain("notes");
    expect(slugs.some((s) => /^notes-\d+$/.test(s))).toBe(true);
  });

  test("title falls back to first heading then basename", () => {
    const noFm = `## First Heading\n\nbody`;
    expect(parseStructural("a.md", noFm).title).toBe("First Heading");
    expect(parseStructural("notes/plain.md", "plain body").title).toBe(
      "plain",
    );
  });

  test("skips headings inside fenced code blocks", () => {
    const fenced = "## Real\n\n```\n## Fake\n```\n\n## Also Real\n";
    const r = parseStructural("x.md", fenced);
    const headings = r.sections
      .filter((s) => s.level > 0)
      .map((s) => s.headingText);
    expect(headings).toEqual(["Real", "Also Real"]);
  });
});
