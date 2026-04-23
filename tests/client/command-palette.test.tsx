// tests/client/command-palette.test.tsx
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { CommandPalette } from "../../src/client/components/CommandPalette";
import { useStore } from "../../src/client/store";

const __mockFetch = (async (url: string) => {
  if (url.includes("/api/search")) {
    return new Response(JSON.stringify([
      { path: "notes/test.md", title: "Test Note", snippet: "A test" },
    ]));
  }
  return new Response(JSON.stringify([]));
}) as any;
beforeEach(() => { globalThis.fetch = __mockFetch; });

beforeEach(() => {
  useStore.setState({ commandPaletteOpen: true, notes: [
    { path: "notes/recent.md", title: "Recent Note", tags: [], created: "", modified: "2026-04-11", aliases: [], domain: null, subdomain: null, identifierTags: [], topicTags: [] },
  ]});
});

afterEach(() => cleanup());

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

describe("CommandPalette — Move to project action", () => {
  test("shows 'Move to project…' when currentPath is a projects/ path", () => {
    render(
      <MemoryRouter>
        <CommandPalette currentPath="projects/_inbox/research/x.md" />
      </MemoryRouter>,
    );
    expect(screen.getByText(/Move to project/i)).toBeDefined();
  });

  test("Move action POSTs to /api/notes/<path>/move and calls onNavigate", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      calls.push({ url: String(url), body });
      return new Response(
        JSON.stringify({ ok: true, new_path: "projects/dbtmg/research/x.md" }),
        { status: 200 },
      );
    }) as typeof fetch;

    const navs: string[] = [];
    render(
      <MemoryRouter>
        <CommandPalette
          currentPath="projects/_inbox/research/x.md"
          onNavigate={(p) => navs.push(p)}
        />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByText(/Move to project/i));
    fireEvent.change(screen.getByLabelText("Project"), {
      target: { value: "dbtmg" },
    });
    fireEvent.change(screen.getByLabelText("Doc type"), {
      target: { value: "research" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Move" }));

    await waitFor(() => {
      const call = calls.find((c) => c.url.includes("/move"));
      expect(call).toBeDefined();
      expect(call!.url).toContain(
        "/api/notes/projects/_inbox/research/x.md/move",
      );
      expect(call!.body).toEqual({
        project: "dbtmg",
        doc_type: "research",
      });
    });
    await waitFor(() =>
      expect(navs).toEqual(["projects/dbtmg/research/x.md"]),
    );
  });

  test("Move action rejects empty project / doc_type (no request fires)", async () => {
    const calls: string[] = [];
    globalThis.fetch = (async (url: unknown) => {
      calls.push(String(url));
      return new Response(JSON.stringify({ ok: true }));
    }) as typeof fetch;

    render(
      <MemoryRouter>
        <CommandPalette currentPath="projects/_inbox/research/x.md" />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByText(/Move to project/i));
    // Clear the (pre-filled) project field, then submit — must not fire.
    fireEvent.change(screen.getByLabelText("Project"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Move" }));
    await new Promise((r) => setTimeout(r, 50));
    expect(calls.some((u) => u.includes("/move"))).toBe(false);
  });

  test("Move action surfaces server error (e.g. 409 collision)", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: "target exists" }), {
        status: 409,
      })) as unknown as typeof fetch;

    render(
      <MemoryRouter>
        <CommandPalette currentPath="projects/_inbox/research/x.md" />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByText(/Move to project/i));
    fireEvent.change(screen.getByLabelText("Project"), {
      target: { value: "dbtmg" },
    });
    fireEvent.change(screen.getByLabelText("Doc type"), {
      target: { value: "research" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Move" }));
    expect(
      await screen.findByText(/target exists|failed|error/i),
    ).toBeDefined();
  });

  test("does NOT show Move action when no currentPath", () => {
    render(
      <MemoryRouter>
        <CommandPalette />
      </MemoryRouter>,
    );
    expect(screen.queryByText(/Move to project/i)).toBeNull();
  });
});
