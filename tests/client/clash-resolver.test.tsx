import { test, expect, afterEach } from "bun:test";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { ClashResolver } from "../../src/client/views/ClashResolver";

afterEach(() => { cleanup(); });

const REGIONS = [
  { type: "clean", text: "Stout, grey-braided." },
  { type: "conflict", local: "owes the party a favor", remote: "tips the Thieves' Guild" },
];

test("Resolve & Sync is disabled until every conflict is chosen", async () => {
  globalThis.fetch = (async (url: string) => {
    if (String(url).includes("/api/sync/diff")) return new Response(JSON.stringify({ path: "v.md", regions: REGIONS }), { status: 200 });
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  render(<ClashResolver path="projects/dnd/npcs/volga.md" onDone={() => {}} />);
  const btn = await screen.findByRole("button", { name: /resolve & sync/i });
  expect((btn as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: /keep mine/i }));
  await waitFor(() => expect((screen.getByRole("button", { name: /resolve & sync/i }) as HTMLButtonElement).disabled).toBe(false));
});

test("assembled text uses clean regions + chosen conflict sides and POSTs to resolve", async () => {
  let posted: any = null;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    if (String(url).includes("/api/sync/diff")) return new Response(JSON.stringify({ path: "v.md", regions: REGIONS }), { status: 200 });
    if (String(url).includes("/api/sync/resolve")) { posted = JSON.parse(String(init?.body)); return new Response(JSON.stringify({ ok: true }), { status: 200 }); }
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  render(<ClashResolver path="v.md" onDone={() => {}} />);
  fireEvent.click(await screen.findByRole("button", { name: /take hub/i }));
  fireEvent.click(screen.getByRole("button", { name: /resolve & sync/i }));
  await waitFor(() => expect(posted).not.toBeNull());
  expect(posted.content).toBe("Stout, grey-braided.\ntips the Thieves' Guild");
});
