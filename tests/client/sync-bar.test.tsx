import { test, expect, beforeEach, afterEach } from "bun:test";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { SyncBar } from "../../src/client/components/SyncBar";
import { useSyncStatus } from "../../src/client/stores/syncStatus";

// useSyncStatus is a module-singleton shared across all client test files, so
// reset to a known baseline BEFORE each test — otherwise a prior file leaving
// hubReachable:false would suppress the pull/clash pills this file asserts on.
beforeEach(() => { useSyncStatus.setState({ notPushed: new Set(), clashes: new Set(), toPull: [], hubReachable: true, syncing: false }); });
afterEach(() => { cleanup(); });

test("shows the push / pull / clash breakdown", () => {
  useSyncStatus.setState({ notPushed: new Set(["a.md", "b.md", "c.md"]), clashes: new Set(["d.md"]), toPull: [{ path: "e.md", reason: "pull_new" }, { path: "f.md", reason: "pull_update" }] });
  render(<SyncBar />);
  expect(screen.getByText(/3 to push/)).toBeDefined();
  expect(screen.getByText(/2 to pull/)).toBeDefined();
  expect(screen.getByText(/1 clash/)).toBeDefined();
});

test("offline state shows 'hub offline'", () => {
  useSyncStatus.setState({ hubReachable: false });
  render(<SyncBar />);
  expect(screen.getByText(/hub offline/i)).toBeDefined();
});

test("clicking Sync calls runSync", () => {
  let called = false;
  useSyncStatus.setState({ runSync: async () => { called = true; } } as any);
  render(<SyncBar />);
  fireEvent.click(screen.getByRole("button", { name: /sync/i }));
  expect(called).toBe(true);
});
