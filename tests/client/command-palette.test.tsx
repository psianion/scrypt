// tests/client/command-palette.test.tsx
import { describe, test, expect, beforeEach } from "bun:test";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { CommandPalette } from "../../src/client/components/CommandPalette";
import { useStore } from "../../src/client/store";

globalThis.fetch = (async (url: string) => {
  if (url.includes("/api/search")) {
    return new Response(JSON.stringify([
      { path: "notes/test.md", title: "Test Note", snippet: "A test" },
    ]));
  }
  return new Response(JSON.stringify([]));
}) as any;

beforeEach(() => {
  useStore.setState({ commandPaletteOpen: true, notes: [
    { path: "notes/recent.md", title: "Recent Note", tags: [], created: "", modified: "2026-04-11", aliases: [] },
  ]});
});

function renderPalette() {
  return render(
    <MemoryRouter>
      <CommandPalette />
    </MemoryRouter>
  );
}

describe("CommandPalette", () => {
  test("renders with search input focused", () => {
    renderPalette();
    const input = screen.getByPlaceholderText("Search notes...");
    expect(input).toBeDefined();
    expect(document.activeElement).toBe(input);
  });

  test("shows recent notes when empty", () => {
    renderPalette();
    expect(screen.getByText("Recent Note")).toBeDefined();
  });

  test("Escape closes palette", () => {
    renderPalette();
    fireEvent.keyDown(screen.getByPlaceholderText("Search notes..."), { key: "Escape" });
    expect(useStore.getState().commandPaletteOpen).toBe(false);
  });
});
