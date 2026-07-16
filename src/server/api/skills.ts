// src/server/api/skills.ts
import { join, normalize, sep } from "node:path";
import { readdir, readFile, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import type { Router } from "../router";
import { parseFrontmatter, stringifyFrontmatter } from "../parsers";

export function skillRoutes(router: Router, vaultPath: string): void {
  const skillsDir = join(vaultPath, "skills");

  // :name (and POST body's data.name) are attacker-controlled and land
  // directly in a filesystem path below — contain them to skillsDir the
  // same way api/files.ts's safePath() contains uploads. Returns null for
  // any name that escapes (e.g. "../projects/secret" or an absolute path).
  function safeSkillPath(name: string): string | null {
    const resolved = normalize(join(skillsDir, `${name}.md`));
    if (resolved !== skillsDir && !resolved.startsWith(skillsDir + sep)) return null;
    return resolved;
  }

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
    const filePath = safeSkillPath(params.name);
    if (!filePath || !existsSync(filePath)) {
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
    const filePath = safeSkillPath(data.name);
    if (!filePath) {
      return Response.json({ error: "Invalid name" }, { status: 400 });
    }
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
    const filePath = safeSkillPath(params.name);
    if (!filePath || !existsSync(filePath)) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
    const data = (await req.json()) as Record<string, unknown>;
    const content = stringifyFrontmatter(data, String(data.body || ""));
    await Bun.write(filePath, content);
    return Response.json({ name: params.name });
  });

  router.delete("/api/skills/:name", async (_req, params) => {
    const filePath = safeSkillPath(params.name);
    if (!filePath || !existsSync(filePath)) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
    await unlink(filePath);
    return Response.json({ deleted: params.name });
  });
}
