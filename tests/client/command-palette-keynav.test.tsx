// tests/client/command-palette-keynav.test.tsx
//
// Wave 1 smoke for the rewritten CommandPalette keyboard contract.
// Asserts that ArrowDown/ArrowUp move the data-active marker between
// rendered result rows and that Enter selects the highlighted row.

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { CommandPalette } from "../../src/client/components/CommandPalette";
import { useStore } from "../../src/client/store";

const mockSearch = (async (url: string) => {
  if (url.includes("/api/search")) {
    return new Response(
      JSON.stringify([
        { path: "alpha.md", title: "Alpha", snippet: "" },
        { path: "beta.md", title: "Beta", snippet: "" },
        { path: "gamma.md", title: "Gamma", snippet: "" },
      ]),
    );
  }
  return new Response(JSON.stringify([]));
}) as any;

beforeEach(() => {
  globalThis.fetch = mockSearch;
  useStore.setState({
    commandPaletteOpen: true,
    notes: [
      { path: "alpha.md", title: "Alpha", tags: [], created: "", modified: "", aliases: [] } as any,
      { path: "beta.md", title: "Beta", tags: [], created: "", modified: "", aliases: [] } as any,
      { path: "gamma.md", title: "Gamma", tags: [], created: "", modified: "", aliases: [] } as any,
    ],
    activeTab: null,
    tabs: [],
  });
});

afterEach(() => {
  cleanup();
  // Reset shared store slice so we don't leak activeTab/tabs into the next
  // test file (command-palette.test.tsx asserts no Move action when activeTab
  // is unset; without this reset, keynav's Enter-handler mutation persists).
  useStore.setState({
    commandPaletteOpen: false,
    activeTab: null,
    tabs: [],
    notes: [],
  });
});

describe("CommandPalette keyboard navigation", () => {
  test("ArrowDown moves the data-active marker to the next result", () => {
    render(
      <MemoryRouter>
        <CommandPalette />
      </MemoryRouter>,
    );
    const input = screen.getByPlaceholderText("Search notes...");
    // Initial selection is row 0.
    expect(
      screen.getByTestId("result-alpha.md").hasAttribute("data-active"),
    ).toBe(true);

    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(
      screen.getByTestId("result-beta.md").hasAttribute("data-active"),
    ).toBe(true);
    expect(
      screen.getByTestId("result-alpha.md").hasAttribute("data-active"),
    ).toBe(false);
  });

  test("ArrowUp at row 0 stays clamped, no wrap-around", () => {
    render(
      <MemoryRouter>
        <CommandPalette />
      </MemoryRouter>,
    );
    const input = screen.getByPlaceholderText("Search notes...");
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(
      screen.getByTestId("result-alpha.md").hasAttribute("data-active"),
    ).toBe(true);
  });

  test("Enter on the active row opens the tab and closes the palette", async () => {
    render(
      <MemoryRouter>
        <CommandPalette />
      </MemoryRouter>,
    );
    const input = screen.getByPlaceholderText("Search notes...");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => {
      const state = useStore.getState();
      expect(state.activeTab).toBe("beta.md");
      expect(state.tabs.find((t) => t.path === "beta.md")).toBeDefined();
      expect(state.commandPaletteOpen).toBe(false);
    });
  });
});
