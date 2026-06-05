// src/server/ingest/classify-hints.ts
//
// Deterministic classification *hints* for ingestion. Maps a source path +
// frontmatter to candidate project / doc_type / thread. These are SUGGESTIONS
// ONLY — the AI client confirms and writes final values via update_note_metadata.
// No I/O, no DB, no LLM. Pure function so it's trivially testable.
import { isDocType, type DocType } from "../vocab/doc-types";
import {
  normalizeProjectName,
  isValidProjectSlug,
} from "../vocab/reserved-projects";

export interface HintInput {
  sourcePath: string;
  frontmatter?: Record<string, unknown>;
}

export interface ClassificationHints {
  project: string | null;
  doc_type: DocType | null;
  thread: string | null;
  reasons: string[];
}

function segments(sourcePath: string): string[] {
  return sourcePath
    .split("/")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function asProject(raw: string): string | null {
  const norm = normalizeProjectName(raw);
  return isValidProjectSlug(norm) ? norm : null;
}

function readString(
  fm: Record<string, unknown> | undefined,
  key: string
): string | null {
  const v = fm?.[key];
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

function applyFrontmatter(
  hints: ClassificationHints,
  fm: Record<string, unknown> | undefined
): ClassificationHints {
  const fmProject = readString(fm, "project");
  if (fmProject) {
    const norm = normalizeProjectName(fmProject);
    if (isValidProjectSlug(norm)) {
      hints.project = norm;
      hints.reasons.push("frontmatter:project");
    }
  }
  const fmDocType = fm?.doc_type;
  if (isDocType(fmDocType)) {
    hints.doc_type = fmDocType as DocType;
    hints.reasons.push("frontmatter:doc_type");
  }
  const fmThread = readString(fm, "thread");
  if (fmThread) {
    hints.thread = fmThread;
    hints.reasons.push("frontmatter:thread");
  }
  return hints;
}

export function suggestClassification(input: HintInput): ClassificationHints {
  const hints: ClassificationHints = {
    project: null,
    doc_type: null,
    thread: null,
    reasons: [],
  };
  const parts = segments(input.sourcePath);
  const folders = parts.slice(0, -1); // drop filename — only folders classify

  if (folders[0] === "projects" && folders.length >= 2) {
    const proj = asProject(folders[1]!);
    if (proj) {
      hints.project = proj;
      hints.reasons.push(
        folders.length >= 3
          ? "path:projects/<project>/<doc_type>"
          : "path:projects/<project>"
      );
    }
    if (folders.length >= 3 && isDocType(folders[2]))
      hints.doc_type = folders[2] as DocType;
    return applyFrontmatter(hints, input.frontmatter);
  }

  if (folders[0] === "research" && folders.length >= 2) {
    const proj = asProject(folders[1]!);
    if (proj) {
      hints.project = proj;
      hints.doc_type = "research";
      hints.reasons.push("folder:research/<project>");
    }
    return applyFrontmatter(hints, input.frontmatter);
  }

  if (folders.length >= 1) {
    const proj = asProject(folders[0]!);
    if (proj) {
      hints.project = proj;
      hints.reasons.push("folder:top-level");
    }
    for (const f of folders.slice(1)) {
      if (isDocType(f)) {
        hints.doc_type = f as DocType;
        break;
      }
    }
  }

  return applyFrontmatter(hints, input.frontmatter);
}
