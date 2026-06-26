import { test, expect } from "bun:test";
import { isValidKind } from "../../../src/server/ingest/kinds";

test("journal is no longer an ingest kind", () => {
  expect(isValidKind("journal")).toBe(false);
});
