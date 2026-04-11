// tests/server/parsers.test.ts
import { describe, test, expect } from "bun:test";
import {
  parseFrontmatter,
  stringifyFrontmatter,
  extractWikiLinks,
  extractTags,
  extractTasks,
} from "../../src/server/parsers";

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
