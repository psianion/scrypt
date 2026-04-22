import { basename } from "node:path";
import { isDocType, type DocType } from "../vocab/doc-types";
import { isValidProjectSlug } from "../vocab/reserved-projects";

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface ParsedVaultPath {
  project: string;
  docType: DocType;
  slug: string;
}

export function parseVaultPath(path: string): ParsedVaultPath | null {
  if (!path.endsWith(".md")) return null;
  const parts = path.split("/");
  if (parts.length !== 4) return null;
  if (parts[0] !== "projects") return null;

  const project = parts[1]!;
  const docType = parts[2]!;
  const slug = basename(parts[3]!, ".md");

  if (!isValidProjectSlug(project)) return null;
  if (!isDocType(docType)) return null;
  if (!SLUG_RE.test(slug) || slug.length > 40) return null;

  return { project, docType, slug };
}

export function buildVaultPath(
  project: string,
  docType: DocType,
  slug: string,
): string {
  return `projects/${project}/${docType}/${slug}.md`;
}

// Extended projectOf — recognizes the new `projects/...` layout AND the old
// `research/<dom>/...` layout for the transition window. Drop the research/
// branch once every vault is reingested.
export function projectOf(path: string): string {
  const parts = path.split("/");
  if (parts[0] === "projects" && parts.length > 1 && parts[1]) return parts[1];
  if (parts[0] === "research" && parts.length > 2 && parts[1]) return parts[1];
  return parts[0] ?? "root";
}

export function docTypeOf(path: string): DocType | null {
  const parts = path.split("/");
  if (parts[0] === "projects" && parts.length >= 4 && isDocType(parts[2]!)) {
    return parts[2] as DocType;
  }
  return null;
}

export function slugOf(path: string): string {
  return basename(path, ".md");
}
