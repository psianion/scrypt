import { describe, test, expect, afterEach, beforeEach } from "bun:test";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { NoteContextPanel } from "../../src/client/graph/NoteContextPanel";
import type { Note } from "../../src/shared/types";

const __mockFetch = (async () =>
  new Response(JSON.stringify(null), { status: 404 })) as any;
beforeEach(() => {
  globalThis.fetch = __mockFetch;
});

afterEach(() => cleanup());

function wrap(ui: React.ReactNode) {
  return <MemoryRouter>{ui}</MemoryRouter>;
}

describe("NoteContextPanel — provenance", () => {
  const base: Note = {
    path: "projects/p/plan/x.md",
    title: "X",
    tags: [],
    created: "",
    modified: "",
    aliases: [],
    domain: null,
    subdomain: null,
    identifierTags: [],
    topicTags: [],
    content: "",
    frontmatter: {},
    slug: "x",
    project: "p",
    doc_type: "plan",
    ingest: {
      original_filename: "old-name.md",
      original_path: "/abs/old-name.md",
      source_mtime: "2026-04-10T00:00:00Z",
      ingested_at: "2026-04-22T00:00:00Z",
      model: "claude-opus-4-7",
      source_hash: "deadbeef",
      source_size: 1024,
      tokens: 500,
      cost_usd: 0.002,
      ingest_version: "v3",
    },
  };

  test("surfaces original filename + ingested_at + model", () => {
    render(wrap(<NoteContextPanel path={base.path} note={base} />));
    expect(screen.getByText("old-name.md")).toBeDefined();
    expect(screen.getByText(/2026-04-22/)).toBeDefined();
    expect(screen.getByText("claude-opus-4-7")).toBeDefined();
    expect(screen.getByText("/abs/old-name.md")).toBeDefined();
    expect(screen.getByText(/2026-04-10/)).toBeDefined();
  });

  test("does NOT surface source_hash / tokens / cost_usd without ?debug=1", () => {
    render(wrap(<NoteContextPanel path={base.path} note={base} />));
    expect(screen.queryByText("deadbeef")).toBeNull();
    expect(screen.queryByText(/500 tokens/)).toBeNull();
    expect(screen.queryByText(/\$0\.002/)).toBeNull();
    expect(screen.queryByText("v3")).toBeNull();
  });

  test("surfaces debug fields when debug=true prop is set", () => {
    render(wrap(<NoteContextPanel path={base.path} note={base} debug />));
    expect(screen.getByText("deadbeef")).toBeDefined();
    expect(screen.getByText(/500/)).toBeDefined();
    expect(screen.getByText(/0\.002/)).toBeDefined();
  });

  test("hides provenance section when note has no ingest block", () => {
    const without = { ...base, ingest: null };
    render(wrap(<NoteContextPanel path={base.path} note={without} />));
    expect(screen.queryByText(/provenance/i)).toBeNull();
    expect(screen.queryByText("old-name.md")).toBeNull();
  });
});
