// tests/client/search.test.tsx
import { describe, test, expect, afterEach, beforeEach } from "bun:test";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { BrowserRouter } from "react-router";
import { SearchView } from "../../src/client/views/SearchView";

afterEach(() => cleanup());

const __mockFetch = (async (url: string) => {
  if (url.includes("/api/search?q=test")) {
    return new Response(JSON.stringify([
      { path: "notes/result.md", title: "Result Note", snippet: "This is a <b>test</b> match." },
    ]));
  }
  return new Response(JSON.stringify([]));
}) as any;
beforeEach(() => { globalThis.fetch = __mockFetch; });

describe("SearchView", () => {
  test("shows search input", () => {
    render(<BrowserRouter><SearchView /></BrowserRouter>);
    expect(screen.getByPlaceholderText(/search/i)).toBeDefined();
  });

  test("typing queries /api/search with debounce", async () => {
    render(<BrowserRouter><SearchView /></BrowserRouter>);
    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: "test" } });
    expect(await screen.findByText("Result Note")).toBeDefined();
  });
});
