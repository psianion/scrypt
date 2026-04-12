// src/server/api/skills.ts
import { join } from "node:path";
import { readdir, readFile, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import type { Router } from "../router";
import { parseFrontmatter, stringifyFrontmatter } from "../parsers";

export function skillRoutes(router: Router, vaultPath: string): void {
  const skillsDir = join(vaultPath, "skills");

  router.get("/api/skills", async () => {
    try {
      const files = await readdir(skillsDir);
      const skills = [];
      for (const f of files) {
        if (!f.endsWith(".md")) continue;
        const content = await readFile(join(skillsDir, f), "utf-8");
        const { frontmatter } = parseFrontmatter(content);
        skills.push({
          name: (frontmatter.name as string) || f.replace(".md", ""),
          description: (frontmatter.description as string) || "",
          path: `skills/${f}`,
        });
      }
      return Response.json(skills);
    } catch {
      return Response.json([]);
    }
  });

  router.get("/api/skills/:name", async (_req, params) => {
    const filePath = join(skillsDir, `${params.name}.md`);
    if (!existsSync(filePath)) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
    const content = await readFile(filePath, "utf-8");
    const { frontmatter, body } = parseFrontmatter(content);
    return Response.json({ ...frontmatter, body });
  });

  router.post("/api/skills", async (req) => {
    const data = (await req.json()) as {
      name: string;
      description: string;
      input: Record<string, string>;
      output: string;
      body: string;
    };
    const filePath = join(skillsDir, `${data.name}.md`);
    const fm = {
      name: data.name,
      description: data.description,
      input: data.input,
      output: data.output,
    };
    const content = stringifyFrontmatter(fm, data.body);
    await Bun.write(filePath, content);
    return Response.json({ name: data.name }, { status: 201 });
  });

  router.put("/api/skills/:name", async (req, params) => {
    const filePath = join(skillsDir, `${params.name}.md`);
    if (!existsSync(filePath)) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
    const data = (await req.json()) as Record<string, unknown>;
    const content = stringifyFrontmatter(data, String(data.body || ""));
    await Bun.write(filePath, content);
    return Response.json({ name: params.name });
  });

  router.delete("/api/skills/:name", async (_req, params) => {
    const filePath = join(skillsDir, `${params.name}.md`);
    if (!existsSync(filePath)) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
    await unlink(filePath);
    return Response.json({ deleted: params.name });
  });
}
