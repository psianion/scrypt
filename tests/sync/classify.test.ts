import { test, expect } from "bun:test";
import { classify } from "../../src/server/sync/classify";

const m = (o: Record<string, string>) => new Map(Object.entries(o));

test("in sync when local == remote == base", () => {
  const p = classify(m({ "a.md": "h" }), m({ "a.md": "h" }), m({ "a.md": "h" }));
  expect(p.inSync.map((i) => i.path)).toEqual(["a.md"]);
});

test("push_update when only local changed since base", () => {
  const p = classify(m({ "a.md": "L" }), m({ "a.md": "B" }), m({ "a.md": "B" }));
  expect(p.toPush).toEqual([{ path: "a.md", reason: "push_update" }]);
});

test("pull_update when only remote changed since base", () => {
  const p = classify(m({ "a.md": "B" }), m({ "a.md": "R" }), m({ "a.md": "B" }));
  expect(p.toPull).toEqual([{ path: "a.md", reason: "pull_update" }]);
});

test("clash when both changed since base", () => {
  const p = classify(m({ "a.md": "L" }), m({ "a.md": "R" }), m({ "a.md": "B" }));
  expect(p.clashes).toEqual([{ path: "a.md", reason: "clash" }]);
});

test("clash on first run when both present and differ with no base", () => {
  const p = classify(m({ "a.md": "L" }), m({ "a.md": "R" }), m({}));
  expect(p.clashes).toEqual([{ path: "a.md", reason: "clash" }]);
});

test("push_new for a brand-new local note", () => {
  const p = classify(m({ "a.md": "L" }), m({}), m({}));
  expect(p.toPush).toEqual([{ path: "a.md", reason: "push_new" }]);
});

test("pull_new for a brand-new remote note", () => {
  const p = classify(m({}), m({ "a.md": "R" }), m({}));
  expect(p.toPull).toEqual([{ path: "a.md", reason: "pull_new" }]);
});

test("removed_on_hub: local-only with a base is skipped, not re-pushed", () => {
  const p = classify(m({ "a.md": "L" }), m({}), m({ "a.md": "L" }));
  expect(p.skipped).toEqual([{ path: "a.md", reason: "removed_on_hub" }]);
  expect(p.toPush).toEqual([]);
});

test("removed_locally: remote-only with a base is skipped, not pulled", () => {
  const p = classify(m({}), m({ "a.md": "R" }), m({ "a.md": "R" }));
  expect(p.skipped).toEqual([{ path: "a.md", reason: "removed_locally" }]);
  expect(p.toPull).toEqual([]);
});

test("in_sync when local and remote converged to the same content despite a different base", () => {
  const p = classify(m({ "a.md": "X" }), m({ "a.md": "X" }), m({ "a.md": "Y" }));
  expect(p.inSync).toEqual([{ path: "a.md", reason: "in_sync" }]);
  expect(p.clashes).toEqual([]);
});

test("removed_on_hub keeps local even if local changed after the base (never auto-delete)", () => {
  const p = classify(m({ "a.md": "L2" }), m({}), m({ "a.md": "L1" }));
  expect(p.skipped).toEqual([{ path: "a.md", reason: "removed_on_hub" }]);
  expect(p.toPush).toEqual([]);
});
