import { test, expect } from "bun:test";
import { validateProjectPath } from "../../src/server/path/validate-project-path";

test("accepts matching path + frontmatter", () => {
  const r = validateProjectPath("projects/dbtmg/plan/x.md", {
    project: "dbtmg",
    doc_type: "plan",
    slug: "x",
  });
  expect(r.ok).toBe(true);
});

test("rejects project mismatch", () => {
  const r = validateProjectPath("projects/dbtmg/plan/x.md", {
    project: "goveva",
    doc_type: "plan",
    slug: "x",
  });
  expect(r.ok).toBe(false);
  expect(r.code).toBe("path_frontmatter_mismatch");
});

test("rejects doc_type mismatch", () => {
  const r = validateProjectPath("projects/dbtmg/plan/x.md", {
    project: "dbtmg",
    doc_type: "spec",
    slug: "x",
  });
  expect(r.ok).toBe(false);
});

test("rejects slug mismatch", () => {
  const r = validateProjectPath("projects/dbtmg/plan/x.md", {
    project: "dbtmg",
    doc_type: "plan",
    slug: "y",
  });
  expect(r.ok).toBe(false);
});

test("rejects non-projects paths", () => {
  const r = validateProjectPath("research/dbtmg/x.md", {});
  expect(r.ok).toBe(false);
  expect(r.code).toBe("invalid_layout");
});

test("rejects frontmatter missing required fields", () => {
  const r = validateProjectPath("projects/dbtmg/plan/x.md", { project: "dbtmg" });
  expect(r.ok).toBe(false);
  expect(r.code).toBe("missing_fields");
});
