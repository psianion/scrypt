import { describe, test, expect, afterEach } from "bun:test";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { BrowserRouter } from "react-router";
import { NotesList } from "../../src/client/views/NotesList";

globalThis.fetch = (async (url: string) => {
  if (url.startsWith("/api/notes")) {
    return new Response(
      JSON.stringify([
        {
          path: "notes/a.md",
          title: "A Note",
          tags: ["intro"],
          modified: "2026-04-12T10:00:00Z",
          created: "2026-04-10T10:00:00Z",
          aliases: [],
        },
        {
          path: "notes/b.md",
          title: "B Note",
          tags: ["project"],
          modified: "2026-04-11T10:00:00Z",
          created: "2026-04-11T10:00:00Z",
          aliases: [],
        },
      ]),
    );
  }
  return new Response("[]");
}) as any;

afterEach(() => cleanup());

describe("NotesList", () => {
  test("renders all notes with titles", async () => {
    render(
      <BrowserRouter>
        <NotesList />
      </BrowserRouter>,
    );
    expect(await screen.findByText("A Note")).toBeDefined();
    expect(screen.getByText("B Note")).toBeDefined();
  });

  test("shows tags", async () => {
    render(
      <BrowserRouter>
        <NotesList />
      </BrowserRouter>,
    );
    expect(await screen.findByText(/intro/)).toBeDefined();
    expect(screen.getByText(/project/)).toBeDefined();
  });

  test("sorts by modified desc by default", async () => {
    render(
      <BrowserRouter>
        <NotesList />
      </BrowserRouter>,
    );
    const rows = await screen.findAllByTestId("note-row");
    expect(rows[0].textContent).toContain("A Note");
    expect(rows[1].textContent).toContain("B Note");
  });

  test("filter by tag narrows the list", async () => {
    render(
      <BrowserRouter>
        <NotesList />
      </BrowserRouter>,
    );
    await screen.findByText("A Note");
    const filterInput = screen.getByPlaceholderText(/filter by tag/i);
    fireEvent.change(filterInput, { target: { value: "intro" } });
    expect(screen.queryByText("B Note")).toBeNull();
    expect(screen.getByText("A Note")).toBeDefined();
  });
});
