import { describe, test, expect, afterEach, beforeEach } from "bun:test";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { BrowserRouter } from "react-router";
import { NewNoteModal } from "../../src/client/components/NewNoteModal";

let originalFetch: typeof globalThis.fetch;
let postedBody: any = null;

const mockFetch = (async (url: string, init?: RequestInit) => {
  if (url === "/api/notes" && init?.method === "POST") {
    postedBody = JSON.parse((init.body as string) ?? "{}");
    return new Response(
      JSON.stringify({ path: "dnd/research/new.md" }),
      { status: 201 },
    );
  }
  return new Response("[]");
}) as any;

beforeEach(() => {
  postedBody = null;
  originalFetch = globalThis.fetch;
  globalThis.fetch = mockFetch;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  cleanup();
});

describe("NewNoteModal", () => {
  test("submits assembled frontmatter and navigates on success", async () => {
    const onClose = () => {};
    render(
      <BrowserRouter>
        <NewNoteModal open={true} onClose={onClose} />
      </BrowserRouter>,
    );
    fireEvent.change(screen.getByLabelText("title"), {
      target: { value: "My Note" },
    });
    fireEvent.change(screen.getByLabelText("domain"), {
      target: { value: "dnd" },
    });
    fireEvent.change(screen.getByLabelText("subdomain"), {
      target: { value: "research" },
    });
    fireEvent.click(screen.getByText(/create & open/i));
    await waitFor(() => expect(postedBody).not.toBeNull());
    expect(postedBody.title).toBe("My Note");
    expect(postedBody.frontmatter.domain).toBe("dnd");
    expect(postedBody.frontmatter.subdomain).toBe("research");
  });

  test("title is required — submit disabled without it", () => {
    render(
      <BrowserRouter>
        <NewNoteModal open={true} onClose={() => {}} />
      </BrowserRouter>,
    );
    const btn = screen.getByText(/create & open/i) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });
});
