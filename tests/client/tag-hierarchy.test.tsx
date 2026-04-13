import { describe, test, expect, afterEach, beforeEach } from "bun:test";
import { render, screen, cleanup } from "@testing-library/react";
import { BrowserRouter } from "react-router";
import { TagBrowser } from "../../src/client/views/TagBrowser";

const __mockFetch = (async () =>
  new Response(
    JSON.stringify([
      { tag: "project", count: 5 },
      { tag: "project/scrypt", count: 3 },
      { tag: "project/other", count: 2 },
      { tag: "reference", count: 8 },
    ]),
  )) as any;
beforeEach(() => { globalThis.fetch = __mockFetch; });

afterEach(() => cleanup());

describe("TagBrowser", () => {
  test("groups tags by parent", async () => {
    render(
      <BrowserRouter>
        <TagBrowser />
      </BrowserRouter>,
    );
    expect(await screen.findByText("project")).toBeDefined();
    expect(screen.getByText("reference")).toBeDefined();
  });

  test("shows tag counts", async () => {
    render(
      <BrowserRouter>
        <TagBrowser />
      </BrowserRouter>,
    );
    expect(await screen.findByText("5")).toBeDefined();
  });
});
