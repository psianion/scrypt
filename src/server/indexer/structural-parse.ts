// src/server/indexer/structural-parse.ts
//
// Deterministic structural parse shared by the file-watch indexer and the
// MCP create_note tool. Produces everything downstream code needs without
// any LLM call: frontmatter, wikilinks, tags, heading tree with section
// ranges, and a content hash of the body.
import matter from "gray-matter";
import { createHash } from "crypto";

export interface ParsedSection {
  id: string;
  headingSlug: string;
  headingText: string;
  level: number;
  startLine: number;
  endLine: number;
}

export interface ParsedWikilink {
  target: string;
  line: number;
}

export interface ParsedStructural {
  notePath: string;
  frontmatter: Record<string, unknown>;
  body: string;
  title: string;
  sections: ParsedSection[];
  wikilinks: ParsedWikilink[];
  tags: string[];
  contentHash: string;
}

const SLUG_RE = /[^a-z0-9]+/g;
const WIKILINK_RE = /\[\[([^\]]+)\]\]/g;
const TAG_RE = /(?:^|\s)#([a-zA-Z][a-zA-Z0-9_/-]*)/g;

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(SLUG_RE, "-")
    .replace(/^-|-$/g, "");
}

function noteSlug(notePath: string): string {
  return notePath.replace(/\.md$/, "").replace(/[^a-zA-Z0-9]+/g, "_");
}

export function parseStructural(
  notePath: string,
  content: string,
): ParsedStructural {
  const parsed = matter(content);
  const body = parsed.content;
  const fm = (parsed.data ?? {}) as Record<string, unknown>;
  const lines = body.split("\n");

  interface Heading {
    level: number;
    text: string;
    line: number;
  }
  const headings: Heading[] = [];
  let inFence = false;
  lines.forEach((ln, i) => {
    if (/^```/.test(ln)) {
      inFence = !inFence;
      return;
    }
    if (inFence) return;
    const m = /^(#{1,6})\s+(.+?)\s*$/.exec(ln);
    if (m) headings.push({ level: m[1].length, text: m[2], line: i });
  });

  const nslug = noteSlug(notePath);
  const slugsSeen = new Set<string>();
  const sections: ParsedSection[] = [];

  const firstHeadingLine = headings[0]?.line ?? lines.length;
  if (firstHeadingLine > 0 || headings.length === 0) {
    sections.push({
      id: `${nslug}:h-intro-0`,
      headingSlug: "h-intro-0",
      headingText: "(intro)",
      level: 0,
      startLine: 0,
      endLine: Math.max(0, firstHeadingLine - 1),
    });
    slugsSeen.add("h-intro-0");
  }

  headings.forEach((h, idx) => {
    const nextLine = headings[idx + 1]?.line ?? lines.length;
    const baseSlug = slugify(h.text);
    const slug = slugsSeen.has(baseSlug) ? `${baseSlug}-${h.line}` : baseSlug;
    slugsSeen.add(slug);
    sections.push({
      id: `${nslug}:${slug}`,
      headingSlug: slug,
      headingText: h.text,
      level: h.level,
      startLine: h.line,
      endLine: Math.max(h.line, nextLine - 1),
    });
  });

  const wikilinks: ParsedWikilink[] = [];
  lines.forEach((ln, i) => {
    for (const m of ln.matchAll(WIKILINK_RE)) {
      const raw = m[1].split("|")[0].trim();
      wikilinks.push({ target: raw, line: i });
    }
  });

  const tagSet = new Set<string>();
  for (const m of body.matchAll(TAG_RE)) tagSet.add(m[1]);
  if (Array.isArray(fm.tags)) for (const t of fm.tags) tagSet.add(String(t));

  const title =
    (typeof fm.title === "string" && fm.title) ||
    headings[0]?.text ||
    notePath.split("/").pop()?.replace(/\.md$/, "") ||
    notePath;

  const contentHash = createHash("sha256").update(body).digest("hex");

  return {
    notePath,
    frontmatter: fm,
    body,
    title,
    sections,
    wikilinks,
    tags: Array.from(tagSet),
    contentHash,
  };
}
