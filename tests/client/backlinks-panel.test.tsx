// tests/client/backlinks-panel.test.tsx
import { describe, test, expect, afterEach, beforeEach } from "bun:test";
import { render, screen, cleanup } from "@testing-library/react";
import { BrowserRouter } from "react-router";
import { BacklinksPanel } from "../../src/client/views/BacklinksPanel";
import { useStore } from "../../src/client/store";

const __mockFetch = (async () =>
  new Response(JSON.stringify([
    { sourcePath: "notes/ref.md", sourceTitle: "Reference", context: "See [[current]]" },
  ]))
) as any;
beforeEach(() => { globalThis.fetch = __mockFetch; });

afterEach(() => cleanup());

describe("BacklinksPanel", () => {
  test("displays list of linking notes with context", async () => {
    useStore.setState({
      currentNote: {
        path: "notes/current.md", title: "Current", content: "", tags: [],
        created: "", modified: "", aliases: [], frontmatter: {},
        domain: null, subdomain: null, identifierTags: [], topicTags: [],
      },
    });
    render(<BrowserRouter><BacklinksPanel /></BrowserRouter>);
    expect(await screen.findByText("Reference")).toBeDefined();
  });

  test("shows count in header", async () => {
    useStore.setState({
      currentNote: {
        path: "notes/x.md", title: "X", content: "", tags: [],
        created: "", modified: "", aliases: [], frontmatter: {},
        domain: null, subdomain: null, identifierTags: [], topicTags: [],
      },
    });
    render(<BrowserRouter><BacklinksPanel /></BrowserRouter>);
    expect(await screen.findByText(/backlinks/i)).toBeDefined();
  });

  test("shows 'No backlinks' when empty", async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify([]))) as any;
    useStore.setState({
      currentNote: {
        path: "notes/lonely.md", title: "Lonely", content: "", tags: [],
        created: "", modified: "", aliases: [], frontmatter: {},
        domain: null, subdomain: null, identifierTags: [], topicTags: [],
      },
    });
    render(<BrowserRouter><BacklinksPanel /></BrowserRouter>);
    expect(await screen.findByText(/no backlinks/i)).toBeDefined();
  });
});
