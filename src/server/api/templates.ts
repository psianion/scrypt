// src/server/api/templates.ts
import { join } from "node:path";
import { readdir } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import type { Router } from "../router";
import type { FileManager } from "../file-manager";

export function templateRoutes(router: Router, fm: FileManager, vaultPath: string): void {
  const templatesDir = join(vaultPath, "templates");

  router.get("/api/templates", async () => {
    try {
      const files = await readdir(templatesDir);
      const templates = files
        .filter((f) => f.endsWith(".md"))
        .map((f) => ({ name: f.replace(".md", ""), file: f }));
      return Response.json(templates);
    } catch {
      return Response.json([]);
    }
  });

  router.post("/api/templates/apply", async (req) => {
    const body = await req.json();
    const templateFile = join(templatesDir, `${body.template}.md`);
    if (!existsSync(templateFile)) {
      return Response.json({ error: "Template not found" }, { status: 404 });
    }

    let content = await readFile(templateFile, "utf-8");
    const now = new Date().toISOString();
    const date = now.split("T")[0];
    const vars: Record<string, string> = {
      date,
      now,
      title: body.path.split("/").pop()?.replace(".md", "") || "Untitled",
      ...body.variables,
    };

    for (const [key, value] of Object.entries(vars)) {
      content = content.replace(new RegExp(`\\{${key}\\}`, "g"), value);
    }

    const { parseFrontmatter } = await import("../parsers");
    const { frontmatter, body: noteBody } = parseFrontmatter(content);
    await fm.writeNote(body.path, noteBody, frontmatter);

    return Response.json({ path: body.path }, { status: 201 });
  });
}
