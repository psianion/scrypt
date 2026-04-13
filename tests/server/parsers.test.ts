// tests/server/parsers.test.ts
import { describe, test, expect } from "bun:test";
import {
  parseFrontmatter,
  parseTag,
  stringifyFrontmatter,
  extractWikiLinks,
  extractTags,
  extractTasks,
  mergeServerTimestamps,
} from "../../src/server/parsers";
import { RESERVED_NAMESPACES } from "../../src/shared/types";

describe("parseFrontmatter", () => {
  test("extracts YAML frontmatter and body", () => {
    const content = `---
title: Test Note
tags: [project, active]
created: 2026-04-11T10:00:00Z
---

# Test Note

Some content here.`;

    const result = parseFrontmatter(content);
    expect(result.frontmatter.title).toBe("Test Note");
    expect(result.frontmatter.tags).toEqual(["project", "active"]);
    expect(new Date(result.frontmatter.created as string).toISOString()).toBe("2026-04-11T10:00:00.000Z");
    expect(result.body.trim()).toBe("# Test Note\n\nSome content here.");
  });

  test("returns empty frontmatter for notes without it", () => {
    const content = "# Just a heading\n\nSome text.";
    const result = parseFrontmatter(content);
    expect(result.frontmatter).toEqual({});
    expect(result.body).toBe(content);
  });

  test("handles empty content", () => {
    const result = parseFrontmatter("");
    expect(result.frontmatter).toEqual({});
    expect(result.body).toBe("");
  });
});

describe("stringifyFrontmatter", () => {
  test("combines frontmatter and body into markdown", () => {
    const fm = { title: "Test", tags: ["a", "b"] };
    const body = "# Test\n\nContent.";
    const result = stringifyFrontmatter(fm, body);
    expect(result).toContain("---");
    expect(result).toContain("title: Test");
    expect(result).toContain("# Test");

    const reparsed = parseFrontmatter(result);
    expect(reparsed.frontmatter.title).toBe("Test");
    expect(reparsed.body.trim()).toBe(body);
  });
});

describe("extractWikiLinks", () => {
  test("extracts basic [[wiki-links]]", () => {
    const content = "Link to [[Note A]] and [[Note B]].";
    const links = extractWikiLinks(content);
    expect(links).toEqual([
      { target: "Note A", display: undefined },
      { target: "Note B", display: undefined },
    ]);
  });

  test("extracts [[target|display text]] syntax", () => {
    const content = "See [[projects/scrypt|Scrypt Project]] for details.";
    const links = extractWikiLinks(content);
    expect(links).toEqual([
      { target: "projects/scrypt", display: "Scrypt Project" },
    ]);
  });

  test("returns empty array when no links", () => {
    expect(extractWikiLinks("No links here.")).toEqual([]);
  });

  test("ignores links inside code blocks", () => {
    const content = "Normal [[link]]\n```\n[[not-a-link]]\n```\nEnd.";
    const links = extractWikiLinks(content);
    expect(links).toEqual([{ target: "link", display: undefined }]);
  });
});

describe("extractTags", () => {
  test("extracts inline #tags from content", () => {
    const tags = extractTags("A #project and #active note.", {});
    expect(tags).toContain("project");
    expect(tags).toContain("active");
  });

  test("extracts tags from frontmatter", () => {
    const tags = extractTags("No inline tags.", { tags: ["meta", "ref"] });
    expect(tags).toEqual(["meta", "ref"]);
  });

  test("merges inline and frontmatter tags without duplicates", () => {
    const tags = extractTags("A #project note.", {
      tags: ["project", "new"],
    });
    expect(tags.sort()).toEqual(["new", "project"]);
  });

  test("handles hierarchical tags like parent/child", () => {
    const tags = extractTags("A #project/scrypt tag.", {});
    expect(tags).toContain("project/scrypt");
  });

  test("ignores # in headings and code", () => {
    const content = "# Heading\n\n`#not-a-tag`\n\nReal #tag here.";
    const tags = extractTags(content, {});
    expect(tags).toEqual(["tag"]);
  });
});

describe("extractTags > regressions", () => {
  test("does NOT pick up 3-char hex colors", () => {
    const tags = extractTags("The color is #fff and #333", {});
    expect(tags).not.toContain("fff");
    expect(tags).not.toContain("333");
  });

  test("does NOT pick up 6-char hex colors", () => {
    const tags = extractTags("Background: #f3f3f3, accent: #333333.", {});
    expect(tags).not.toContain("f3f3f3");
    expect(tags).not.toContain("333333");
  });

  test("does NOT pick up 8-char hex colors (with alpha)", () => {
    const tags = extractTags("rgba-style: #ff00ff80", {});
    expect(tags).not.toContain("ff00ff80");
  });

  test("does NOT pick up numeric-only #1, #2", () => {
    const tags = extractTags("Step #1 then #2 then #3.", {});
    expect(tags).not.toContain("1");
    expect(tags).not.toContain("2");
  });

  test("still picks up alpha tags like #project and #3d-printing", () => {
    const tags = extractTags("#project and #3d-printing are real.", {});
    expect(tags).toContain("project");
    expect(tags).toContain("3d-printing");
  });

  test("skips tags inside fenced code blocks", () => {
    const content = [
      "Normal #realtag here.",
      "```",
      "#fake_inside_fence",
      "```",
      "More #another outside.",
    ].join("\n");
    const tags = extractTags(content, {});
    expect(tags).toContain("realtag");
    expect(tags).toContain("another");
    expect(tags).not.toContain("fake_inside_fence");
  });

  test("skips tags inside inline code spans", () => {
    const tags = extractTags("Use `#inline_fake` but #outline is real.", {});
    expect(tags).toContain("outline");
    expect(tags).not.toContain("inline_fake");
  });
});

describe("extractTasks", () => {
  test("extracts unchecked tasks", () => {
    const content = "- [ ] Buy groceries\n- [ ] Read book";
    const tasks = extractTasks(content);
    expect(tasks).toEqual([
      { text: "Buy groceries", done: false, line: 1 },
      { text: "Read book", done: false, line: 2 },
    ]);
  });

  test("extracts checked tasks", () => {
    const content = "- [x] Done task";
    const tasks = extractTasks(content);
    expect(tasks).toEqual([{ text: "Done task", done: true, line: 1 }]);
  });

  test("returns empty array when no tasks", () => {
    expect(extractTasks("Just text.")).toEqual([]);
  });

  test("handles mixed content with tasks", () => {
    const content = "# Title\n\nSome text.\n\n- [ ] Task one\n- [x] Task two\n\nMore text.";
    const tasks = extractTasks(content);
    expect(tasks).toHaveLength(2);
    expect(tasks[0]).toEqual({ text: "Task one", done: false, line: 5 });
    expect(tasks[1]).toEqual({ text: "Task two", done: true, line: 6 });
  });
});

describe("mergeServerTimestamps", () => {
  test("sets created and modified on a brand new note", () => {
    const before = Date.now();
    const out = mergeServerTimestamps({}, { existingCreated: null });
    const after = Date.now();
    expect(out.created).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(out.modified).toBe(out.created);
    expect(new Date(out.created as string).getTime()).toBeGreaterThanOrEqual(before);
    expect(new Date(out.created as string).getTime()).toBeLessThanOrEqual(after);
  });

  test("preserves existing created and bumps modified", async () => {
    const existingCreated = "2026-01-01T00:00:00.000Z";
    await Bun.sleep(2);
    const out = mergeServerTimestamps(
      { title: "X", created: "should-be-ignored" },
      { existingCreated },
    );
    expect(out.created).toBe(existingCreated);
    expect(out.modified).not.toBe(existingCreated);
  });

  test("ignores client-set modified", () => {
    const out = mergeServerTimestamps(
      { modified: "2020-01-01T00:00:00.000Z" },
      { existingCreated: null },
    );
    expect(out.modified).not.toBe("2020-01-01T00:00:00.000Z");
  });
});

describe("parseTag", () => {
  test("flat tag has null namespace", () => {
    expect(parseTag("architecture")).toEqual({
      namespace: null,
      value: "architecture",
      raw: "architecture",
    });
  });

  test("namespaced tag splits on first colon", () => {
    expect(parseTag("type:research")).toEqual({
      namespace: "type",
      value: "research",
      raw: "type:research",
    });
  });

  test("value portion is slugified", () => {
    expect(parseTag("project:LongRest 2.0")).toEqual({
      namespace: "project",
      value: "longrest-2-0",
      raw: "project:LongRest 2.0",
    });
  });

  test("value with internal colons keeps them", () => {
    expect(parseTag("url:https://example.com")).toEqual({
      namespace: "url",
      value: "https-example-com",
      raw: "url:https://example.com",
    });
  });
});

describe("parseFrontmatter — domain/subdomain/tags", () => {
  test("reads domain and subdomain fields", () => {
    const raw = `---
title: Foo
domain: dnd
subdomain: research
---

body`;
    const result = parseFrontmatter(raw);
    expect(result.meta.domain).toBe("dnd");
    expect(result.meta.subdomain).toBe("research");
  });

  test("splits identifierTags from topicTags", () => {
    const raw = `---
title: Foo
tags:
  - type:research
  - project:longrest
  - architecture
  - landing-page
---

body`;
    const result = parseFrontmatter(raw);
    expect(result.meta.identifierTags.map((t) => t.raw)).toEqual([
      "type:research",
      "project:longrest",
    ]);
    expect(result.meta.topicTags).toEqual(["architecture", "landing-page"]);
  });

  test("missing domain/subdomain are null, not undefined", () => {
    const raw = `---
title: Foo
---

body`;
    const result = parseFrontmatter(raw);
    expect(result.meta.domain).toBeNull();
    expect(result.meta.subdomain).toBeNull();
  });

  test("legacy tags array still populated with raw strings", () => {
    const raw = `---
title: Foo
tags: ["type:research", "architecture"]
---

body`;
    const result = parseFrontmatter(raw);
    expect(result.meta.tags).toEqual(["type:research", "architecture"]);
  });
});
