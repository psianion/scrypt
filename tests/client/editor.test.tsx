// tests/client/editor.test.tsx
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { Editor } from "../../src/client/views/Editor";
import { useStore } from "../../src/client/store";

let lastFetchUrl = "";
let lastFetchMethod = "";
globalThis.fetch = (async (url: string, init?: RequestInit) => {
  lastFetchUrl = url;
  lastFetchMethod = init?.method || "GET";
  if (url.includes("/api/notes/") && !init?.method) {
    return new Response(JSON.stringify({
      path: "notes/test.md", title: "Test", content: "# Test\n\nHello [[linked]].",
      tags: [], created: "", modified: "", aliases: [], frontmatter: {},
      backlinks: [{ sourcePath: "notes/other.md", sourceTitle: "Other", context: "See [[test]]" }],
    }));
  }
  return new Response(JSON.stringify({}));
}) as any;

beforeEach(() => {
  lastFetchUrl = "";
  lastFetchMethod = "";
  useStore.setState({ currentNote: null });
});

afterEach(() => cleanup());

function renderEditor() {
  return render(
    <MemoryRouter initialEntries={["/note/notes/test.md"]}>
      <Routes>
        <Route path="/note/*" element={<Editor />} />
      </Routes>
    </MemoryRouter>
  );
}

describe("Editor", () => {
  test("fetches note and sets currentNote in store", async () => {
    renderEditor();
    await waitFor(() => {
      expect(useStore.getState().currentNote).not.toBeNull();
    });
    expect(useStore.getState().currentNote!.path).toBe("notes/test.md");
  });

  test("renders CodeMirror editor element", async () => {
    renderEditor();
    await waitFor(() => {
      const editor = screen.getByTestId("editor");
      expect(editor.querySelector(".cm-editor")).not.toBeNull();
    });
  });

  test("saves content on Cmd+S", async () => {
    renderEditor();
    await waitFor(() => {
      expect(screen.getByTestId("editor").querySelector(".cm-editor")).not.toBeNull();
    });
    lastFetchUrl = "";
    lastFetchMethod = "";
    fireEvent.keyDown(document, { key: "s", metaKey: true });
    await waitFor(() => {
      expect(lastFetchMethod).toBe("PUT");
    });
  });
});
