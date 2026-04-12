import { describe, test, expect, afterEach } from "bun:test";
import { render, screen, cleanup } from "@testing-library/react";
import { CsvEmbed } from "../../src/client/views/CsvEmbed";

globalThis.fetch = (async () =>
  new Response(
    JSON.stringify([
      { title: "Dune", author: "Herbert" },
      { title: "1984", author: "Orwell" },
    ]),
  )) as any;

afterEach(() => cleanup());

describe("CsvEmbed", () => {
  test("renders table with CSV headers as columns", async () => {
    render(<CsvEmbed file="books.csv" />);
    expect(await screen.findByText(/title/)).toBeDefined();
    expect(screen.getByText(/author/)).toBeDefined();
  });

  test("renders row data", async () => {
    render(<CsvEmbed file="books.csv" />);
    expect(await screen.findByText("Dune")).toBeDefined();
    expect(screen.getByText("Orwell")).toBeDefined();
  });
});
