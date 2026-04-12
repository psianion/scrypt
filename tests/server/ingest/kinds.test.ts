import { describe, test, expect } from "bun:test";
import {
  KINDS,
  isValidKind,
  destinationFor,
  type Kind,
} from "../../../src/server/ingest/kinds";

describe("KINDS", () => {
  test("contains exactly the 10 expected kinds", () => {
    expect(new Set(KINDS)).toEqual(
      new Set([
        "thread",
        "research_run",
        "memory",
        "spec",
        "plan",
        "note",
        "log",
        "thought",
        "idea",
        "journal",
      ]),
    );
  });
});

describe("isValidKind", () => {
  test("returns true for known kinds", () => {
    for (const k of KINDS) expect(isValidKind(k)).toBe(true);
  });
  test("returns false for unknown", () => {
    expect(isValidKind("foo")).toBe(false);
    expect(isValidKind("")).toBe(false);
  });
});

describe("destinationFor", () => {
  const now = new Date("2026-04-12T03:14:05.000Z");

  test("thread", () => {
    expect(destinationFor("thread", "arm-sve2", now)).toBe(
      "notes/threads/arm-sve2.md",
    );
  });

  test("research_run", () => {
    expect(destinationFor("research_run", "sve2-survey", now)).toBe(
      "notes/research/2026-04-12-0314-sve2-survey.md",
    );
  });

  test("memory", () => {
    expect(destinationFor("memory", "3d-printing", now)).toBe(
      "memory/3d-printing.md",
    );
  });

  test("spec", () => {
    expect(destinationFor("spec", "auth-design", now)).toBe(
      "docs/specs/2026-04-12-auth-design.md",
    );
  });

  test("plan", () => {
    expect(destinationFor("plan", "auth-rollout", now)).toBe(
      "docs/plans/2026-04-12-auth-rollout.md",
    );
  });

  test("note", () => {
    expect(destinationFor("note", "quick-idea", now)).toBe(
      "notes/inbox/quick-idea.md",
    );
  });

  test("log", () => {
    expect(destinationFor("log", "deploy-run", now)).toBe(
      "notes/logs/2026-04-12-deploy-run.md",
    );
  });

  test("thought", () => {
    expect(destinationFor("thought", "shower-idea", now)).toBe(
      "notes/thoughts/2026-04-12-0314-shower-idea.md",
    );
  });

  test("idea", () => {
    expect(destinationFor("idea", "new-product", now)).toBe(
      "notes/ideas/new-product.md",
    );
  });

  test("journal always goes to today's file", () => {
    expect(destinationFor("journal", "ignored-slug", now)).toBe(
      "journal/2026-04-12.md",
    );
  });
});
