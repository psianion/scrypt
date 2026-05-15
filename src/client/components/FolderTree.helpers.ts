// Sidebar tree builder.
//
// Groups notes by project → doc_type → [note]. `_inbox` is pinned to the top
// of the sidebar (§6.1.2); other projects are alphabetical. Empty doc_type
// buckets are not materialised here — the UI surfaces the full enum only when
// the "Show all types" toggle is on (§6.1.2).
//
// `project` / `doc_type` come from the server-side denormalised columns on
// every note row. When absent (legacy notes, or an ad-hoc caller), we derive
// them from the path — the ingest-v3 layout is `projects/<p>/<dt>/<slug>.md`.

export interface FolderTreeNote {
  path: string;
  title?: string | null;
  project?: string | null;
  doc_type?: string | null;
  thread?: string | null;
}

export interface ProjectGroup {
  project: string;
  total: number;
  /** doc_type → notes, sorted alphabetically by doc_type and by title within. */
  docTypes: Map<string, FolderTreeNote[]>;
}

const RESERVED_TOP_LEVEL = new Set([
  "journal",
  "data",
  "assets",
  ".scrypt",
  "dist",
]);

export function deriveProjectDocType(path: string): {
  project: string | null;
  doc_type: string | null;
} {
  const parts = path.split("/");
  if (parts[0] === "projects" && parts.length >= 4 && parts[1] && parts[2]) {
    return { project: parts[1], doc_type: parts[2] };
  }
  return { project: null, doc_type: null };
}

export interface BuildOpts {
  thread?: { project: string; thread: string } | null;
  /** When set, restrict the tree to a single project (matches both
   * ingest-v3 `note.project` and legacy first-path-segment layouts). */
  project?: string | null;
}

/**
 * Top-level vault folders that act as project namespaces.
 *
 * Project chips in the sidebar source from this list — the canonical reading
 * is "the user's actual top-level folders in the vault" (e.g. `dnd`, `scrypt`).
 *
 * Two layouts are supported:
 *   - ingest-v3:  `projects/<p>/<dt>/<slug>.md`  → project = `<p>`
 *   - legacy:     `<top>/...`                   → project = `<top>`
 *
 * RESERVED_TOP_LEVEL entries (`journal`, `data`, etc.) are filtered out so
 * housekeeping folders never surface as projects.
 */
export function topLevelProjects(notes: FolderTreeNote[]): string[] {
  const set = new Set<string>();
  for (const note of notes) {
    const parts = note.path.split("/");
    const top = parts[0] ?? "";
    if (!top || RESERVED_TOP_LEVEL.has(top)) continue;

    if (top === "projects") {
      // ingest-v3 — projects/<p>/<dt>/<slug>.md
      if (parts[1]) set.add(parts[1]);
    } else {
      // legacy / user-created top-level folder
      set.add(top);
    }
  }
  return [...set].sort((a, b) => {
    if (a === "_inbox") return -1;
    if (b === "_inbox") return 1;
    return a.localeCompare(b);
  });
}

/** True when `note` belongs to `project` under either layout. */
function noteMatchesProject(note: FolderTreeNote, project: string): boolean {
  if (note.project === project) return true;
  const parts = note.path.split("/");
  if (parts[0] === "projects" && parts[1] === project) return true;
  if (parts[0] === project) return true;
  return false;
}

export function buildProjectTree(
  notes: FolderTreeNote[],
  opts: BuildOpts = {},
): ProjectGroup[] {
  const byProject = new Map<string, Map<string, FolderTreeNote[]>>();

  for (const note of notes) {
    const top = note.path.split("/")[0] ?? "";
    if (RESERVED_TOP_LEVEL.has(top)) continue;

    let project = note.project ?? null;
    let docType = note.doc_type ?? null;
    if (!project || !docType) {
      const derived = deriveProjectDocType(note.path);
      project = project ?? derived.project;
      docType = docType ?? derived.doc_type;
    }
    if (!project || !docType) continue;

    if (opts.thread) {
      if (project !== opts.thread.project || note.thread !== opts.thread.thread) {
        continue;
      }
    }

    if (opts.project && !noteMatchesProject(note, opts.project)) {
      continue;
    }

    if (!byProject.has(project)) byProject.set(project, new Map());
    const docMap = byProject.get(project)!;
    if (!docMap.has(docType)) docMap.set(docType, []);
    docMap.get(docType)!.push(note);
  }

  const groups: ProjectGroup[] = [];
  for (const [project, docMap] of byProject) {
    const sorted = new Map(
      [...docMap.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(
          ([dt, ns]) =>
            [
              dt,
              [...ns].sort((a, b) =>
                (a.title ?? a.path).localeCompare(b.title ?? b.path),
              ),
            ] as const,
        ),
    );
    let total = 0;
    for (const ns of sorted.values()) total += ns.length;
    groups.push({ project, total, docTypes: sorted });
  }

  groups.sort((a, b) => {
    if (a.project === "_inbox") return -1;
    if (b.project === "_inbox") return 1;
    return a.project.localeCompare(b.project);
  });

  return groups;
}
