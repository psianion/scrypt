import { test, expect, afterEach } from "bun:test";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { ClashResolver } from "../../src/client/views/ClashResolver";
import { useToastStore } from "../../src/client/stores/toast";

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

// ---------------------------------------------------------------------------
// F18 / F4: 'Keep both' assembly — explicit ordering (yours, then hub) and
// crucially no duplicate frontmatter. The base-aware 3-way merge keeps the
// single frontmatter block in a CLEAN region, so 'Keep both' only ever
// concatenates the genuinely-divergent body lines — never two YAML blocks.
// ---------------------------------------------------------------------------
const FM_REGIONS = [
  { type: "clean", text: "---\ntitle: Volga\ndoc_type: npc\n---" },
  { type: "conflict", local: "owes the party a favor", remote: "tips the Thieves' Guild" },
];

test("'Keep both' assembles local then remote in document order (F18)", async () => {
  let posted: any = null;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    if (String(url).includes("/api/sync/diff")) return new Response(JSON.stringify({ path: "v.md", regions: REGIONS }), { status: 200 });
    if (String(url).includes("/api/sync/resolve")) { posted = JSON.parse(String(init?.body)); return new Response(JSON.stringify({ ok: true }), { status: 200 }); }
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as typeof fetch;
  render(<ClashResolver path="v.md" onDone={() => {}} />);
  fireEvent.click(await screen.findByRole("button", { name: /keep both/i }));
  fireEvent.click(screen.getByRole("button", { name: /resolve & sync/i }));
  await waitFor(() => expect(posted).not.toBeNull());
  // yours first, then hub — never the reverse, never duplicated.
  expect(posted.content).toBe("Stout, grey-braided.\nowes the party a favor\ntips the Thieves' Guild");
});

test("'Keep both' on a note with frontmatter produces exactly one frontmatter block (F4)", async () => {
  let posted: any = null;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    if (String(url).includes("/api/sync/diff")) return new Response(JSON.stringify({ path: "v.md", regions: FM_REGIONS }), { status: 200 });
    if (String(url).includes("/api/sync/resolve")) { posted = JSON.parse(String(init?.body)); return new Response(JSON.stringify({ ok: true }), { status: 200 }); }
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as typeof fetch;
  render(<ClashResolver path="v.md" onDone={() => {}} />);
  fireEvent.click(await screen.findByRole("button", { name: /keep both/i }));
  fireEvent.click(screen.getByRole("button", { name: /resolve & sync/i }));
  await waitFor(() => expect(posted).not.toBeNull());
  // The frontmatter stays a single clean region; both body sides are kept.
  expect(posted.content).toBe("---\ntitle: Volga\ndoc_type: npc\n---\nowes the party a favor\ntips the Thieves' Guild");
  // Pre-fix whole-document conflict would have concatenated two full notes,
  // yielding two `---` fences. Assert the document opens with exactly one.
  const fenceCount = posted.content.split("\n").filter((l: string) => l === "---").length;
  expect(fenceCount).toBe(2); // one opening + one closing fence = a single block
});

// ---------------------------------------------------------------------------
// F8: an edit-vs-delete clash emits a conflict region whose remote side is ''.
// The empty side must (a) render an explicit "removes these lines" affordance
// rather than a blank box, and (b) be filtered out of the assembled text so
// the join does not inject a phantom blank line into the pushed document.
// ---------------------------------------------------------------------------
const DELETE_REGIONS = [
  { type: "clean", text: "Stout, grey-braided." },
  { type: "conflict", local: "owes the party a favor", remote: "" },
  { type: "clean", text: "Last seen in Neverwinter." },
];

test("empty conflict side renders a removal affordance, not a blank choice box (F8)", async () => {
  globalThis.fetch = (async (url: string) => {
    if (String(url).includes("/api/sync/diff")) return new Response(JSON.stringify({ path: "v.md", regions: DELETE_REGIONS }), { status: 200 });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as typeof fetch;
  render(<ClashResolver path="v.md" onDone={() => {}} />);
  await screen.findByRole("button", { name: /take hub/i });
  // The deletion side shows the explicit placeholder...
  const placeholder = screen.getByText(/removes these lines/i);
  expect(placeholder).toBeTruthy();
  expect(placeholder.className).toContain("cc__text--del");
  // ...and the surviving (local) side still renders its real body text, so the
  // placeholder belongs to the empty remote box, not a blanket blank render.
  expect(screen.getByText("owes the party a favor")).toBeTruthy();
});

test("choosing the deletion side drops the line cleanly with no phantom blank line (F8)", async () => {
  let posted: any = null;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    if (String(url).includes("/api/sync/diff")) return new Response(JSON.stringify({ path: "v.md", regions: DELETE_REGIONS }), { status: 200 });
    if (String(url).includes("/api/sync/resolve")) { posted = JSON.parse(String(init?.body)); return new Response(JSON.stringify({ ok: true }), { status: 200 }); }
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as typeof fetch;
  render(<ClashResolver path="v.md" onDone={() => {}} />);
  // Accept the hub's deletion (remote === "").
  fireEvent.click(await screen.findByRole("button", { name: /take hub/i }));
  fireEvent.click(screen.getByRole("button", { name: /resolve & sync/i }));
  await waitFor(() => expect(posted).not.toBeNull());
  // No "X\n\nY" — the empty chosen side is filtered out before the join.
  expect(posted.content).toBe("Stout, grey-braided.\nLast seen in Neverwinter.");
  expect(posted.content).not.toContain("\n\n");
});

// ---------------------------------------------------------------------------
// F9: a fully auto-mergeable diff (disjoint edits, zero conflict regions) must
// NOT let the user blind-commit. The CTA stays disabled until an explicit
// "I've reviewed the auto-merge" confirmation, and the copy is not the
// misleading "0 of 0 conflicts resolved".
// ---------------------------------------------------------------------------
const AUTOMERGE_REGIONS = [
  { type: "clean", text: "Stout, grey-braided." },
  { type: "clean", text: "owes the party a favor" },
  { type: "clean", text: "tips the Thieves' Guild" },
];

test("auto-mergeable diff disables the CTA until the merge is explicitly accepted (F9)", async () => {
  globalThis.fetch = (async (url: string) => {
    if (String(url).includes("/api/sync/diff")) return new Response(JSON.stringify({ path: "v.md", regions: AUTOMERGE_REGIONS }), { status: 200 });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as typeof fetch;
  render(<ClashResolver path="v.md" onDone={() => {}} />);
  const cta = await screen.findByRole("button", { name: /accept auto-merge/i });
  // Before confirming, the machine merge cannot be committed.
  expect((cta as HTMLButtonElement).disabled).toBe(true);
  // The footer must not falsely claim "0 of 0 conflicts resolved".
  expect(screen.queryByText(/0 of 0 conflicts/i)).toBeNull();
  // Confirming the review enables the CTA.
  fireEvent.click(screen.getByRole("checkbox"));
  await waitFor(() => expect((screen.getByRole("button", { name: /accept auto-merge/i }) as HTMLButtonElement).disabled).toBe(false));
});

test("auto-mergeable diff only POSTs after explicit acceptance (F9)", async () => {
  let posted: any = null;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    if (String(url).includes("/api/sync/diff")) return new Response(JSON.stringify({ path: "v.md", regions: AUTOMERGE_REGIONS }), { status: 200 });
    if (String(url).includes("/api/sync/resolve")) { posted = JSON.parse(String(init?.body)); return new Response(JSON.stringify({ ok: true }), { status: 200 }); }
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as typeof fetch;
  render(<ClashResolver path="v.md" onDone={() => {}} />);
  await screen.findByRole("button", { name: /accept auto-merge/i });
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: /accept auto-merge/i }));
  await waitFor(() => expect(posted).not.toBeNull());
  // All disjoint edits survive, assembled in document order.
  expect(posted.content).toBe("Stout, grey-braided.\nowes the party a favor\ntips the Thieves' Guild");
});

// ---------------------------------------------------------------------------
// F11: diff-load and resolve failure paths must show a clear message instead of
// hanging on "Loading…" (HTTP-200 hub_unreachable) or surfacing the misleading
// generic error for a 409 no_diff (already resolved elsewhere — good news).
// ---------------------------------------------------------------------------
test("offline diff load (HTTP-200 hub_unreachable) shows a clear message, not an eternal spinner (F11)", async () => {
  globalThis.fetch = (async (url: string) => {
    if (String(url).includes("/api/sync/diff")) return new Response(JSON.stringify({ ok: false, error: "hub_unreachable" }), { status: 200 });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as typeof fetch;
  render(<ClashResolver path="v.md" onDone={() => {}} />);
  expect(await screen.findByText(/hub offline/i)).toBeTruthy();
  // Not stuck on the loading placeholder, and a way out is offered.
  expect(screen.queryByText(/loading/i)).toBeNull();
  expect(screen.getByRole("button", { name: /back to editor/i })).toBeTruthy();
});

test("409 no_diff (already resolved elsewhere) reports success and calls onDone (F11)", async () => {
  let done = false;
  globalThis.fetch = (async (url: string) => {
    if (String(url).includes("/api/sync/diff")) return new Response(JSON.stringify({ error: "no_diff" }), { status: 409 });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as typeof fetch;
  render(<ClashResolver path="v.md" onDone={() => { done = true; }} />);
  await waitFor(() => expect(done).toBe(true));
  // The misleading generic "couldn't load" error must NOT appear.
  expect(screen.queryByText(/couldn't load the clash/i)).toBeNull();
});

test("a thrown diff-load error shows the load-failed message and a way out (F11)", async () => {
  globalThis.fetch = (async (url: string) => {
    if (String(url).includes("/api/sync/diff")) throw new Error("network down");
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as typeof fetch;
  render(<ClashResolver path="v.md" onDone={() => {}} />);
  expect(await screen.findByText(/couldn't load the clash/i)).toBeTruthy();
  expect(screen.queryByText(/loading/i)).toBeNull();
  expect(screen.getByRole("button", { name: /back to editor/i })).toBeTruthy();
});

test("a failing resolve POST shows an error toast and does NOT call onDone (F11)", async () => {
  let done = false;
  globalThis.fetch = (async (url: string) => {
    if (String(url).includes("/api/sync/diff")) return new Response(JSON.stringify({ path: "v.md", regions: REGIONS }), { status: 200 });
    if (String(url).includes("/api/sync/resolve")) return new Response(JSON.stringify({ ok: false, error: "hub_unreachable" }), { status: 500 });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as typeof fetch;
  useToastStore.getState().clear();
  render(<ClashResolver path="v.md" onDone={() => { done = true; }} />);
  fireEvent.click(await screen.findByRole("button", { name: /take hub/i }));
  fireEvent.click(screen.getByRole("button", { name: /resolve & sync/i }));
  await waitFor(() => expect(useToastStore.getState().toasts.some((t) => t.variant === "error" && /resolve failed/i.test(t.title))).toBe(true));
  expect(done).toBe(false);
});
