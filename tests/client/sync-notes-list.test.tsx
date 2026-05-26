import { test, expect, afterEach } from "bun:test";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { NotesList } from "../../src/client/views/NotesList";
import { useSyncStatus } from "../../src/client/stores/syncStatus";

afterEach(() => { cleanup(); useSyncStatus.setState({ notPushed: new Set(), clashes: new Set() }); });

test("NotesList shows a clash dot in the title cell", async () => {
  useSyncStatus.setState({ clashes: new Set(["projects/dnd/npcs/volga.md"]) });
  // NotesList loads via api.notes.list — stub fetch to return one note:
  globalThis.fetch = (async () => new Response(JSON.stringify([{ path: "projects/dnd/npcs/volga.md", title: "Volga", tags: [], modified: "2026-05-26" }]), { status: 200 })) as unknown as typeof fetch;
  render(<MemoryRouter><NotesList /></MemoryRouter>);
  expect(await screen.findByTitle("Clash")).toBeDefined();
});
