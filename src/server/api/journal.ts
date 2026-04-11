// src/server/api/journal.ts
import { join } from "node:path";
import { readFileSync, existsSync } from "node:fs";
import type { Router } from "../router";
import type { FileManager } from "../file-manager";
import type { Indexer } from "../indexer";

export function journalRoutes(
  router: Router,
  fm: FileManager,
  indexer: Indexer,
  vaultPath: string
): void {
  router.get("/api/journal/today", async () => {
    const today = new Date().toISOString().split("T")[0];
    return await getOrCreateJournalEntry(today, fm, indexer, vaultPath);
  });

  router.get("/api/journal/:date", async (_req, params) => {
    const path = `journal/${params.date}.md`;
    const note = await fm.readNote(path);
    if (!note) return Response.json({ error: "Not found" }, { status: 404 });
    return Response.json(note);
  });
}

async function getOrCreateJournalEntry(
  date: string,
  fm: FileManager,
  indexer: Indexer,
  vaultPath: string
) {
  const path = `journal/${date}.md`;
  const existing = await fm.readNote(path);
  if (existing) return Response.json(existing);

  // Load daily template
  const templatePath = join(vaultPath, "templates", "daily.md");
  let content = "---\ntitle: \"" + date + "\"\ntags: [journal, daily]\n---\n\n# " + date + "\n\n";

  if (existsSync(templatePath)) {
    content = readFileSync(templatePath, "utf-8");
    const now = new Date().toISOString();
    content = content
      .replace(/\{date\}/g, date)
      .replace(/\{now\}/g, now)
      .replace(/\{title\}/g, date);
  }

  const { parseFrontmatter } = await import("../parsers");
  const { frontmatter, body } = parseFrontmatter(content);
  await fm.writeNote(path, body, frontmatter);
  await indexer.reindexNote(path);

  const note = await fm.readNote(path);
  return Response.json(note);
}
