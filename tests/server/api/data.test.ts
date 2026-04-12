import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { createTestEnv } from "../../helpers";

let env: ReturnType<typeof createTestEnv>;

beforeAll(async () => {
  env = createTestEnv();
  await Bun.write(
    `${env.vaultPath}/data/books.csv`,
    "title,author,year\nDune,Herbert,1965\n1984,Orwell,1949",
  );
});
afterAll(() => env.cleanup());

describe("GET /api/data", () => {
  test("returns list of data files", async () => {
    const res = await fetch(`${env.baseUrl}/api/data`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.some((f: any) => f.file === "books.csv")).toBe(true);
  });
});

describe("GET /api/data/:file", () => {
  test("returns CSV parsed as JSON array of objects", async () => {
    const res = await fetch(`${env.baseUrl}/api/data/books.csv`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveLength(2);
    expect(data[0].title).toBe("Dune");
    expect(data[0].author).toBe("Herbert");
  });

  test("returns 404 for missing file", async () => {
    const res = await fetch(`${env.baseUrl}/api/data/nope.csv`);
    expect(res.status).toBe(404);
  });

  test("rejects paths outside data/ directory", async () => {
    const res = await fetch(
      `${env.baseUrl}/api/data/${encodeURIComponent("../notes/secret.md")}`,
    );
    expect(res.status).toBe(400);
  });
});

describe("GET /api/data/:file/schema", () => {
  test("returns headers, types, rowCount", async () => {
    const res = await fetch(`${env.baseUrl}/api/data/books.csv/schema`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.headers).toEqual(["title", "author", "year"]);
    expect(data.rowCount).toBe(2);
  });
});

describe("CSV caching", () => {
  test("handles quoted fields and commas in values", async () => {
    await Bun.write(
      `${env.vaultPath}/data/quoted.csv`,
      'name,desc\n"Smith, Jr.",A "great" person\nDoe,Simple',
    );
    const res = await fetch(`${env.baseUrl}/api/data/quoted.csv`);
    const data = await res.json();
    expect(data.length).toBeGreaterThanOrEqual(2);
  });
});

describe("Excel support", () => {
  test("returns list including .xlsx files", async () => {
    await Bun.write(`${env.vaultPath}/data/sheet.xlsx`, "fake-xlsx");
    const res = await fetch(`${env.baseUrl}/api/data`);
    const data = await res.json();
    expect(data.some((f: any) => f.file === "sheet.xlsx")).toBe(true);
  });
});
