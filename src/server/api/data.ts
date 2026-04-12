// src/server/api/data.ts
import { join, normalize } from "node:path";
import { readdir } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import type { Router } from "../router";

function parseCsv(content: string): Record<string, string>[] {
  const rows: Record<string, string>[] = [];
  const lines: string[][] = [];
  let cur: string[] = [];
  let field = "";
  let inQuote = false;

  for (let i = 0; i < content.length; i++) {
    const c = content[i];
    if (inQuote) {
      if (c === '"' && content[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        inQuote = false;
      } else {
        field += c;
      }
    } else {
      if (c === '"') {
        inQuote = true;
      } else if (c === ",") {
        cur.push(field);
        field = "";
      } else if (c === "\n" || c === "\r") {
        if (c === "\r" && content[i + 1] === "\n") i++;
        cur.push(field);
        field = "";
        if (cur.length > 1 || cur[0] !== "") lines.push(cur);
        cur = [];
      } else {
        field += c;
      }
    }
  }
  if (field.length > 0 || cur.length > 0) {
    cur.push(field);
    if (cur.length > 1 || cur[0] !== "") lines.push(cur);
  }

  if (lines.length < 2) return rows;
  const headers = lines[0].map((h) => h.trim());
  for (let i = 1; i < lines.length; i++) {
    const row: Record<string, string> = {};
    headers.forEach((h, j) => (row[h] = (lines[i][j] ?? "").trim()));
    rows.push(row);
  }
  return rows;
}

export function dataRoutes(router: Router, vaultPath: string): void {
  const dataDir = join(vaultPath, "data");

  function safePath(file: string): string | null {
    const resolved = normalize(join(dataDir, file));
    if (!resolved.startsWith(dataDir)) return null;
    return resolved;
  }

  router.get("/api/data", async () => {
    try {
      const files = await readdir(dataDir);
      return Response.json(
        files
          .filter((f) => f.endsWith(".csv") || f.endsWith(".xlsx"))
          .map((f) => ({ file: f })),
      );
    } catch {
      return Response.json([]);
    }
  });

  router.get("/api/data/*file/schema", (_req, params) => {
    const filePath = safePath(params.file);
    if (!filePath) return Response.json({ error: "Invalid path" }, { status: 400 });
    if (!existsSync(filePath)) return Response.json({ error: "Not found" }, { status: 404 });

    const content = readFileSync(filePath, "utf-8");
    const rows = parseCsv(content);
    const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
    const types = headers.map(() => "string");

    return Response.json({ headers, types, rowCount: rows.length });
  });

  router.get("/api/data/*file", (_req, params) => {
    const filePath = safePath(params.file);
    if (!filePath) return Response.json({ error: "Invalid path" }, { status: 400 });
    if (!existsSync(filePath)) return Response.json({ error: "Not found" }, { status: 404 });

    const content = readFileSync(filePath, "utf-8");
    return Response.json(parseCsv(content));
  });
}
