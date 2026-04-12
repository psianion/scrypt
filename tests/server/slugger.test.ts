import { describe, test, expect } from "bun:test";
import { slugify, uniqueSlug } from "../../src/server/slugger";

describe("slugify", () => {
  test("lowercases and hyphenates", () => {
    expect(slugify("What's new in ARM SVE2?")).toBe("whats-new-in-arm-sve2");
  });

  test("collapses repeated hyphens", () => {
    expect(slugify("a -- b")).toBe("a-b");
  });

  test("trims leading and trailing hyphens", () => {
    expect(slugify("--hello--")).toBe("hello");
  });

  test("strips punctuation", () => {
    expect(slugify("Hello, world!")).toBe("hello-world");
  });

  test("caps at 60 chars at a word boundary", () => {
    const long = "this is a very long title that keeps going and going and going and going";
    const s = slugify(long);
    expect(s.length).toBeLessThanOrEqual(60);
    expect(s.endsWith("-")).toBe(false);
  });

  test("handles unicode by stripping it", () => {
    expect(slugify("日本語 title")).toBe("title");
  });

  test("returns 'untitled' when input is empty after stripping", () => {
    expect(slugify("!!!")).toBe("untitled");
    expect(slugify("")).toBe("untitled");
  });
});

describe("uniqueSlug", () => {
  test("returns base when no collision", () => {
    expect(uniqueSlug("foo", () => false)).toBe("foo");
  });

  test("appends -2 on first collision", () => {
    const taken = new Set(["foo"]);
    expect(uniqueSlug("foo", (s) => taken.has(s))).toBe("foo-2");
  });

  test("keeps counting until unique", () => {
    const taken = new Set(["foo", "foo-2", "foo-3"]);
    expect(uniqueSlug("foo", (s) => taken.has(s))).toBe("foo-4");
  });
});
