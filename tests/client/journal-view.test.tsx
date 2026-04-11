// tests/client/journal-view.test.tsx
import { describe, test, expect, afterEach } from "bun:test";
import { render, screen, cleanup } from "@testing-library/react";
import { BrowserRouter } from "react-router";
import { JournalView } from "../../src/client/views/JournalView";

globalThis.fetch = (async (url: string) => {
  if (url.includes("/api/journal/today")) {
    return new Response(JSON.stringify({
      path: "journal/2026-04-12.md", title: "2026-04-12", content: "# Today\n\nNotes.",
      tags: ["journal"], created: "", modified: "", aliases: [], frontmatter: {},
    }));
  }
  return new Response(JSON.stringify({}));
}) as any;

afterEach(cleanup);

describe("JournalView", () => {
  test("opens today's note on view load", async () => {
    render(<BrowserRouter><JournalView /></BrowserRouter>);
    expect(await screen.findByTestId("journal-view")).toBeDefined();
  });

  test("shows calendar picker for date navigation", async () => {
    render(<BrowserRouter><JournalView /></BrowserRouter>);
    expect(await screen.findByText("Today")).toBeDefined();
  });
});
