import { describe, test, expect, afterEach } from "bun:test";
import { render, screen, cleanup } from "@testing-library/react";
import { BrowserRouter } from "react-router";
import { Settings } from "../../src/client/views/Settings";

globalThis.fetch = (async (url: string) => {
  if (url.includes("/api/plugins")) {
    return new Response(
      JSON.stringify([
        {
          id: "test-plugin",
          name: "Test Plugin",
          version: "1.0.0",
          enabled: false,
        },
      ]),
    );
  }
  return new Response(JSON.stringify({}));
}) as any;

afterEach(() => cleanup());

describe("Settings", () => {
  test("displays editor settings", async () => {
    render(
      <BrowserRouter>
        <Settings />
      </BrowserRouter>,
    );
    expect(await screen.findByText(/font size/i)).toBeDefined();
  });

  test("displays plugin list with toggles", async () => {
    render(
      <BrowserRouter>
        <Settings />
      </BrowserRouter>,
    );
    expect(await screen.findByText("Test Plugin")).toBeDefined();
  });
});
