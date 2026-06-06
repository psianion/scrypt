import { test, expect } from "bun:test";
import { suggestClassification } from "../../../src/server/ingest/classify-hints";

test("derives project + doc_type from a projects/<project>/<doc_type>/ path", () => {
  const h = suggestClassification({ sourcePath: "projects/scrypt/spec/ingestion-rework.md" });
  expect(h.project).toBe("scrypt");
  expect(h.doc_type).toBe("spec");
  expect(h.thread).toBeNull();
  expect(h.reasons).toContain("path:projects/<project>/<doc_type>");
});

test("derives project from a top-level folder name and normalizes it", () => {
  const h = suggestClassification({ sourcePath: "DnD Notes/session-12.md" });
  expect(h.project).toBe("dnd-notes");
  expect(h.reasons).toContain("folder:top-level");
});

test("doc_type comes from a recognized intermediate folder", () => {
  const h = suggestClassification({ sourcePath: "research/dnd/lore.md" });
  expect(h.project).toBe("dnd");
  expect(h.doc_type).toBe("research");
  expect(h.reasons).toContain("folder:research/<project>");
});

test("a file directly under projects/<project>/ derives project, null doc_type", () => {
  const h = suggestClassification({ sourcePath: "projects/scrypt/note.md" });
  expect(h.project).toBe("scrypt");
  expect(h.doc_type).toBeNull();
  expect(h.reasons).toContain("path:projects/<project>");
});

test("unknown intermediate folder yields a null doc_type, not a guess", () => {
  const h = suggestClassification({ sourcePath: "scrypt/misc/thing.md" });
  expect(h.project).toBe("scrypt");
  expect(h.doc_type).toBeNull();
});

test("a bare filename yields all-null suggestions", () => {
  const h = suggestClassification({ sourcePath: "loose-note.md" });
  expect(h.project).toBeNull();
  expect(h.doc_type).toBeNull();
  expect(h.thread).toBeNull();
});

test("frontmatter project/doc_type override the path-derived guess", () => {
  const h = suggestClassification({ sourcePath: "research/dnd/lore.md", frontmatter: { project: "Campaign One", doc_type: "guide" } });
  expect(h.project).toBe("campaign-one");
  expect(h.doc_type).toBe("guide");
  expect(h.reasons).toContain("frontmatter:project");
  expect(h.reasons).toContain("frontmatter:doc_type");
});

test("frontmatter thread is surfaced verbatim when it is a non-empty string", () => {
  const h = suggestClassification({ sourcePath: "projects/scrypt/plan/x.md", frontmatter: { thread: "vault-sync" } });
  expect(h.thread).toBe("vault-sync");
  expect(h.reasons).toContain("frontmatter:thread");
});

test("invalid frontmatter doc_type is ignored, falling back to the path", () => {
  const h = suggestClassification({ sourcePath: "projects/scrypt/spec/x.md", frontmatter: { doc_type: "not-a-real-type" } });
  expect(h.doc_type).toBe("spec");
});
