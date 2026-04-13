import { describe, test, expect, afterEach, beforeEach } from "bun:test";
import { render, screen, cleanup } from "@testing-library/react";
import { BrowserRouter } from "react-router";
import { DataExplorer } from "../../src/client/views/DataExplorer";

const __mockFetch = (async (url: string) => {
  if (url === "/api/data") {
    return new Response(
      JSON.stringify([{ file: "books.csv" }, { file: "movies.csv" }]),
    );
  }
  return new Response(JSON.stringify([]));
}) as any;
beforeEach(() => { globalThis.fetch = __mockFetch; });

afterEach(() => cleanup());

describe("DataExplorer", () => {
  test("lists data files", async () => {
    render(
      <BrowserRouter>
        <DataExplorer />
      </BrowserRouter>,
    );
    expect(await screen.findByText("books.csv")).toBeDefined();
    expect(screen.getByText("movies.csv")).toBeDefined();
  });
});
