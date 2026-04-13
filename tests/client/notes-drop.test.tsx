import { describe, test, expect, afterEach, beforeEach } from "bun:test";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { BrowserRouter } from "react-router";
import { NotesList } from "../../src/client/views/NotesList";

let originalFetch: typeof globalThis.fetch;
let postedBodies: any[] = [];

const mockFetch = (async (url: string, init?: RequestInit) => {
  if (url.startsWith("/api/notes") && init?.method === "POST") {
    postedBodies.push(JSON.parse((init.body as string) ?? "{}"));
    return new Response(
      JSON.stringify({ path: "dnd/research/new.md" }),
      { status: 201 },
    );
  }
  if (url.startsWith("/api/notes")) {
    return new Response("[]");
  }
  return new Response("[]");
}) as any;

beforeEach(() => {
  postedBodies = [];
  originalFetch = globalThis.fetch;
  globalThis.fetch = mockFetch;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  cleanup();
});

describe("NotesList drag-drop", () => {
  test("dropping a markdown file POSTs to /api/notes with parsed frontmatter", async () => {
    render(
      <BrowserRouter>
        <NotesList />
      </BrowserRouter>,
    );
    const zone = screen.getByTestId("notes-list");
    const content = `---\ntitle: Dropped\ndomain: dnd\nsubdomain: research\n---\nbody`;
    const file = new File([content], "dropped.md", { type: "text/markdown" });
    fireEvent.drop(zone, {
      dataTransfer: { files: [file] },
    });
    await waitFor(() => expect(postedBodies.length).toBe(1));
    expect(postedBodies[0].frontmatter.domain).toBe("dnd");
    expect(postedBodies[0].frontmatter.subdomain).toBe("research");
    expect(postedBodies[0].title).toBe("Dropped");
  });

  test("dragover shows the overlay", () => {
    render(
      <BrowserRouter>
        <NotesList />
      </BrowserRouter>,
    );
    const zone = screen.getByTestId("notes-list");
    fireEvent.dragEnter(zone);
    expect(screen.getByText(/drop to add notes/i)).toBeDefined();
  });
});
