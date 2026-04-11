// src/server/parsers.ts
import matter from "gray-matter";
import type { WikiLink, ParsedTask } from "../shared/types";

export function parseFrontmatter(content: string): {
  frontmatter: Record<string, unknown>;
  body: string;
} {
  if (!content || !content.startsWith("---")) {
    return { frontmatter: {}, body: content };
  }
  const { data, content: body } = matter(content);
  return { frontmatter: data, body };
}

export function stringifyFrontmatter(
  frontmatter: Record<string, unknown>,
  body: string
): string {
  return matter.stringify(body, frontmatter);
}

function stripCodeBlocks(content: string): string {
  return content.replace(/```[\s\S]*?```/g, "").replace(/`[^`]+`/g, "");
}

export function extractWikiLinks(content: string): WikiLink[] {
  const stripped = stripCodeBlocks(content);
  const regex = /\[\[([^\]]+)\]\]/g;
  const links: WikiLink[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(stripped)) !== null) {
    const inner = match[1];
    const pipeIndex = inner.indexOf("|");
    if (pipeIndex !== -1) {
      links.push({
        target: inner.slice(0, pipeIndex),
        display: inner.slice(pipeIndex + 1),
      });
    } else {
      links.push({ target: inner, display: undefined });
    }
  }
  return links;
}

export function extractTags(
  content: string,
  frontmatter: Record<string, unknown>
): string[] {
  const tags = new Set<string>();

  // Frontmatter tags
  const fmTags = frontmatter.tags;
  if (Array.isArray(fmTags)) {
    fmTags.forEach((t) => tags.add(String(t)));
  }

  // Inline tags: match #word but not in headings or code
  const lines = content.split("\n");
  for (const line of lines) {
    if (line.startsWith("#") && line.match(/^#+\s/)) continue; // heading
    const cleaned = line.replace(/`[^`]*`/g, ""); // strip inline code
    const regex = /(?:^|\s)#([\w/]+)/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(cleaned)) !== null) {
      tags.add(match[1]);
    }
  }

  return Array.from(tags);
}

export function extractTasks(content: string): ParsedTask[] {
  const tasks: ParsedTask[] = [];
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^\s*-\s+\[([ x])\]\s+(.+)$/);
    if (match) {
      tasks.push({
        text: match[2],
        done: match[1] === "x",
        line: i + 1,
      });
    }
  }
  return tasks;
}
