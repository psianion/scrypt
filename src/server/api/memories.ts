// src/server/api/memories.ts
import type { Router } from "../router";
import type { FileManager } from "../file-manager";
import { parseFrontmatter } from "../parsers";

export function memoryRoutes(router: Router, fm: FileManager): void {
  router.get("/api/memories", async (req) => {
    const url = new URL(req.url);
    const activeParam = url.searchParams.get("active");
    const activeFilter =
      activeParam === "true" ? true : activeParam === "false" ? false : undefined;
    const categoryFilter = url.searchParams.get("category") || undefined;

    const notes = await fm.listNotes();
    const memories = [];
    for (const n of notes) {
      if (!n.path.startsWith("memory/")) continue;
      const raw = await fm.readRaw(n.path);
      if (!raw) continue;
      const { frontmatter, body } = parseFrontmatter(raw);
      if (frontmatter.kind !== "memory") continue;
      const active = frontmatter.active !== false;
      const category = (frontmatter.category as string) ?? "interest";
      const priority =
        typeof frontmatter.priority === "number" ? frontmatter.priority : 1;
      if (activeFilter !== undefined && active !== activeFilter) continue;
      if (categoryFilter && category !== categoryFilter) continue;
      memories.push({
        slug: n.path.replace(/^memory\//, "").replace(/\.md$/, ""),
        path: n.path,
        title: frontmatter.title,
        category,
        priority,
        active,
        created: frontmatter.created,
        modified: frontmatter.modified,
        content: body,
      });
    }
    memories.sort((a, b) => b.priority - a.priority);
    return Response.json(memories);
  });
}
