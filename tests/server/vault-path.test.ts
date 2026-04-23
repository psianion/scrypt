import { test, expect } from "bun:test";
import {
  parseVaultPath,
  buildVaultPath,
  projectOf,
  docTypeOf,
  slugOf,
} from "../../src/server/path/vault-path";

test("parseVaultPath returns project/doc_type/slug for well-formed path", () => {
  const r = parseVaultPath("projects/dbtmg/plan/multi-image-upload.md");
  expect(r).toEqual({ project: "dbtmg", docType: "plan", slug: "multi-image-upload" });
});

test("parseVaultPath returns null for non-projects path", () => {
  expect(parseVaultPath("research/dbtmg/note.md")).toBeNull();
  expect(parseVaultPath("random/path.md")).toBeNull();
});

test("parseVaultPath returns null for invalid doc_type", () => {
  expect(parseVaultPath("projects/dbtmg/xyzzy/note.md")).toBeNull();
});

test("parseVaultPath returns null for paths with extra segments", () => {
  expect(parseVaultPath("projects/dbtmg/plan/nested/note.md")).toBeNull();
});

test("parseVaultPath accepts reserved project _inbox", () => {
  const r = parseVaultPath("projects/_inbox/research/loose.md");
  expect(r).toEqual({ project: "_inbox", docType: "research", slug: "loose" });
});

test("buildVaultPath composes a path", () => {
  expect(buildVaultPath("dbtmg", "plan", "multi-image-upload")).toBe(
    "projects/dbtmg/plan/multi-image-upload.md",
  );
});

test("projectOf returns the project segment for new layout", () => {
  expect(projectOf("projects/dbtmg/plan/x.md")).toBe("dbtmg");
});

test("projectOf falls back to old research/<domain>/... during transition", () => {
  expect(projectOf("research/dbtmg/x.md")).toBe("dbtmg");
});

test("docTypeOf returns the doc_type segment", () => {
  expect(docTypeOf("projects/dbtmg/plan/x.md")).toBe("plan");
  expect(docTypeOf("research/dbtmg/x.md")).toBeNull();
});

test("slugOf returns the filename stem", () => {
  expect(slugOf("projects/dbtmg/plan/multi-image-upload.md")).toBe("multi-image-upload");
});
