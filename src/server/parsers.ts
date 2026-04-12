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

const HEX_COLOR = /^[0-9a-f]{3}$|^[0-9a-f]{6}$|^[0-9a-f]{8}$/i;
const HAS_ALPHA = /[A-Za-z]/;

function extractInlineTagsFromLine(line: string): string[] {
  const stripped = line.replace(/`[^`]*`/g, "");
  const out: string[] = [];
  const re = /(^|[^\w&])#([\w/-]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stripped)) !== null) {
    const tag = m[2];
    if (HEX_COLOR.test(tag)) continue;
    if (!HAS_ALPHA.test(tag)) continue;
    out.push(tag);
  }
  return out;
}

export function extractTags(
  content: string,
  frontmatter: Record<string, unknown>
): string[] {
  const out = new Set<string>();

  const lines = content.split("\n");
  let inFence = false;
  for (const line of lines) {
    const trimmed = line.trimStart();
    if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    for (const tag of extractInlineTagsFromLine(line)) out.add(tag);
  }

  const fmTags = frontmatter.tags;
  if (Array.isArray(fmTags)) {
    for (const t of fmTags) {
      if (typeof t === "string" && HAS_ALPHA.test(t)) out.add(t);
    }
  } else if (typeof fmTags === "string" && HAS_ALPHA.test(fmTags)) {
    out.add(fmTags);
  }

  return Array.from(out);
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

export interface TimestampContext {
  existingCreated: string | null;
}

export function mergeServerTimestamps(
  frontmatter: Record<string, unknown>,
  ctx: TimestampContext,
): Record<string, unknown> {
  const now = new Date().toISOString();
  const { created: _clientCreated, modified: _clientModified, ...rest } =
    frontmatter as Record<string, unknown>;
  return {
    ...rest,
    created: ctx.existingCreated ?? now,
    modified: now,
  };
}
