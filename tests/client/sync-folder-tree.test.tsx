import { test, expect, afterEach } from "bun:test";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { FolderTree } from "../../src/client/components/FolderTree";
import { useSyncStatus } from "../../src/client/stores/syncStatus";

const NOTES = [{ path: "projects/dnd/sessions/s14.md", title: "Session 14", tags: [], project: "dnd", doc_type: "sessions" } as any];
afterEach(() => { cleanup(); useSyncStatus.setState({ notPushed: new Set(), clashes: new Set() }); localStorage.clear(); });

test("a not-pushed note renders a dot titled 'Not pushed'", () => {
  useSyncStatus.setState({ notPushed: new Set(["projects/dnd/sessions/s14.md"]), clashes: new Set() });
  render(<FolderTree notes={NOTES} />);
  fireEvent.click(screen.getByText("sessions"));
  expect(screen.getByTitle("Not pushed")).toBeDefined();
});

test("a clash note renders a dot titled 'Clash'", () => {
  useSyncStatus.setState({ notPushed: new Set(), clashes: new Set(["projects/dnd/sessions/s14.md"]) });
  render(<FolderTree notes={NOTES} />);
  fireEvent.click(screen.getByText("sessions"));
  expect(screen.getByTitle("Clash")).toBeDefined();
});

test("an in-sync note renders no titled sync dot", () => {
  render(<FolderTree notes={NOTES} />);
  fireEvent.click(screen.getByText("sessions"));
  expect(screen.queryByTitle("Not pushed")).toBeNull();
  expect(screen.queryByTitle("Clash")).toBeNull();
});
