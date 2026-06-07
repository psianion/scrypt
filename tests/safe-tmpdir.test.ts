import { test, expect } from "bun:test";
import { safeTempBase } from "./safe-tmpdir";

const REPO = "/Users/x/scrypt";

test("keeps an absolute base that is outside the repo", () => {
  expect(safeTempBase("/var/folders/abc/T", REPO)).toBe("/var/folders/abc/T");
  expect(safeTempBase("/tmp/claude-501", REPO)).toBe("/tmp/claude-501");
});

test("rejects a relative base", () => {
  expect(safeTempBase(".", REPO)).toBe("/tmp");
  expect(safeTempBase("./tmp", REPO)).toBe("/tmp");
  expect(safeTempBase("tmp", REPO)).toBe("/tmp");
});

test("rejects the repo root and anything inside it", () => {
  expect(safeTempBase(REPO, REPO)).toBe("/tmp");
  expect(safeTempBase(REPO + "/", REPO)).toBe("/tmp");
  expect(safeTempBase(REPO + "/sub/dir", REPO)).toBe("/tmp");
});

test("does NOT treat a sibling with a shared prefix as inside the repo", () => {
  expect(safeTempBase("/Users/x/scrypt-other", REPO)).toBe("/Users/x/scrypt-other");
});
