import { test, expect } from "bun:test";
import {
  isLineageReason,
  checkLineageShape,
} from "../../src/server/vocab/lineage-reasons";

test("isLineageReason accepts the three allowed reasons", () => {
  expect(isLineageReason("derives-from")).toBe(true);
  expect(isLineageReason("implements")).toBe(true);
  expect(isLineageReason("supersedes")).toBe(true);
});

test("isLineageReason rejects unknown reasons", () => {
  expect(isLineageReason("extends")).toBe(false);
  expect(isLineageReason("")).toBe(false);
  expect(isLineageReason(null)).toBe(false);
});

test("derives-from accepts spec→research, same project", () => {
  const r = checkLineageShape("derives-from", "spec", "research", "dbtmg", "dbtmg");
  expect(r.ok).toBe(true);
});

test("derives-from rejects cross-project", () => {
  const r = checkLineageShape("derives-from", "spec", "research", "dbtmg", "goveva");
  expect(r.ok).toBe(false);
  expect(r.reason).toContain("share project");
});

test("derives-from rejects wrong source doc_type", () => {
  const r = checkLineageShape("derives-from", "plan", "research", "dbtmg", "dbtmg");
  expect(r.ok).toBe(false);
  expect(r.reason).toContain("source doc_type");
});

test("implements accepts plan→spec", () => {
  expect(checkLineageShape("implements", "plan", "spec", "x", "x").ok).toBe(true);
});

test("implements accepts plan→architecture", () => {
  expect(checkLineageShape("implements", "plan", "architecture", "x", "x").ok).toBe(true);
});

test("implements rejects spec→research", () => {
  expect(checkLineageShape("implements", "spec", "research", "x", "x").ok).toBe(false);
});

test("supersedes requires matching doc_type", () => {
  expect(checkLineageShape("supersedes", "spec", "spec", "x", "x").ok).toBe(true);
  expect(checkLineageShape("supersedes", "spec", "plan", "x", "x").ok).toBe(false);
});
