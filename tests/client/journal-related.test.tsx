import { describe, test, expect, afterEach, beforeEach } from "bun:test";
import { render, screen, cleanup } from "@testing-library/react";
import { BrowserRouter } from "react-router";
import { RelatedPanel } from "../../src/client/components/RelatedPanel";

const fixture = {
  related: {
    notes: [{ path: "dnd/research/fresh.md", title: "Fresh Note" }],
    memories: [{ path: "memory/arch.md", title: "Architecture Interest" }],
    draft_prompts: [{ path: "dnd/research/draft.md", title: "Draft Idea" }],
  },
};

let originalFetch: typeof globalThis.fetch;
const mockFetch = (async (url: string) => {
  if (url.startsWith("/api/daily_context")) {
    return new Response(JSON.stringify(fixture));
  }
  return new Response("[]");
}) as any;

beforeEach(() => {
  originalFetch = globalThis.fetch;
  globalThis.fetch = mockFetch;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  cleanup();
});

describe("RelatedPanel", () => {
  test("renders related notes, memories, and draft prompts", async () => {
    render(
      <BrowserRouter>
        <RelatedPanel />
      </BrowserRouter>,
    );
    expect(await screen.findByText("Fresh Note")).toBeDefined();
    expect(screen.getByText("Architecture Interest")).toBeDefined();
    expect(screen.getByText("Draft Idea")).toBeDefined();
  });

  test("empty sections are hidden", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ related: { notes: [], memories: [], draft_prompts: [] } }))) as any;
    render(
      <BrowserRouter>
        <RelatedPanel />
      </BrowserRouter>,
    );
    await new Promise((r) => setTimeout(r, 10));
    expect(screen.queryByText(/Related notes/i)).toBeNull();
  });
});
