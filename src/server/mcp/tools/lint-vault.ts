// src/server/mcp/tools/lint-vault.ts
//
// S4: the mechanical half of the vault maintenance pass (templates/
// SCHEMA.md "Workflow: lint"). READ-ONLY — computes findings; the agent
// fixes them via the existing write tools. Each list is capped at 50 with
// a truncated flag so the librarian can work in passes.
import { join } from "node:path";
import { ORPHAN_NODE_WHERE } from "../../indexer/report";
import { parseFrontmatter } from "../../parsers";
import type { ToolDef } from "../types";

interface Input {
  inbox_max_age_days?: number;
}

interface OrphanFinding {
  path: string;
  title: string | null;
  doc_type: string | null;
}

interface BrokenLinkFinding {
  source: string;
  target: string;
  tier: string;
  reason: string | null;
}

interface EntityFinding {
  entity: string;
  mention_count: number;
  sample_paths: string[];
}

interface SupersededFinding {
  path: string;
  superseders: string[];
  citing_paths: string[];
}

interface StaleInboxFinding {
  path: string;
  title: string | null;
  age_days: number;
}

const FINDING_KEYS = [
  "orphans",
  "broken_links",
  "entities_without_pages",
  "superseded_still_cited",
  "stale_inbox",
] as const;
type FindingKey = (typeof FINDING_KEYS)[number];

interface Output {
  generated_at: string;
  counts: Record<FindingKey, number>;
  truncated: Record<FindingKey, boolean>;
  orphans: OrphanFinding[];
  broken_links: BrokenLinkFinding[];
  entities_without_pages: EntityFinding[];
  superseded_still_cited: SupersededFinding[];
  stale_inbox: StaleInboxFinding[];
}

const LIST_CAP = 50;
const DAY_MS = 86_400_000;

// Same algorithm as Indexer.slugifyTitle / link_index's titleSlug — entity
// names must slugify identically to hit the same link_index rows.
function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// created/modified/ingested_at arrive as ISO strings, or as Date objects
// when YAML parsed an unquoted timestamp.
function parseWhen(v: unknown): number | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.getTime();
  if (typeof v === "string" && v.length > 0) {
    const t = Date.parse(v);
    if (!Number.isNaN(t)) return t;
  }
  return null;
}

export const lintVaultTool: ToolDef<Input, Output> = {
  name: "lint_vault",
  description:
    "Read-only mechanical sweep for a vault maintenance pass: orphan notes, " +
    "broken links, entities mentioned across notes but lacking a page, " +
    "superseded notes still cited elsewhere, and stale _inbox items. Use it " +
    "at the start of a maintenance/librarian pass and before filing the " +
    "digest note; fix the findings with the existing write tools.",
  inputSchema: {
    type: "object",
    properties: {
      inbox_max_age_days: {
        type: "number",
        description:
          "Flag _inbox notes older than this many days (default 7).",
      },
    },
  },
  async handler(ctx, input) {
    const db = ctx.db;
    const maxAgeDays =
      typeof input.inbox_max_age_days === "number" && input.inbox_max_age_days > 0
        ? input.inbox_max_age_days
        : 7;
    const now = Date.now();

    // 1. Orphans — graph_nodes with no edges (predicate shared with the
    // graph report). Journal/sessionlog notes (plus the legacy `changelog`
    // alias) are chronological logs that are expected to be link-light, and
    // _index.md files are generated project TOCs — flagging either would be
    // noise, so they're excluded. doc_type prefers the denormalised notes
    // column, falling back to note_metadata.
    const orphans = db
      .query<OrphanFinding, []>(
        `SELECT n.id AS path, nt.title,
                COALESCE(nt.doc_type, nm.doc_type) AS doc_type
         FROM graph_nodes n
         JOIN notes nt ON nt.path = n.id
         LEFT JOIN note_metadata nm ON nm.note_path = n.id
         WHERE n.kind = 'note'
           AND ${ORPHAN_NODE_WHERE}
           AND COALESCE(COALESCE(nt.doc_type, nm.doc_type), '')
               NOT IN ('journal', 'sessionlog', 'changelog')
           AND n.id NOT LIKE '%\\_index.md' ESCAPE '\\'
         ORDER BY n.id`,
      )
      .all();

    // 2. Broken links — edge rows whose target resolves to no existing note.
    // Structural link edges use note paths as endpoint ids; section and tag
    // endpoints live in note_sections / graph_nodes(kind!='note'), so those
    // are excluded rather than reported as broken.
    const brokenLinks = db
      .query<BrokenLinkFinding, []>(
        `SELECT e.source, e.target, e.tier, e.reason
         FROM graph_edges e
         WHERE e.target NOT IN (SELECT path FROM notes)
           AND e.target NOT IN (SELECT id FROM note_sections)
           AND e.target NOT IN
               (SELECT id FROM graph_nodes WHERE kind != 'note')
         ORDER BY e.source, e.target`,
      )
      .all();

    // 3. Entities mentioned in note_metadata.entities across >= 3 distinct
    // notes with no matching note title or slug (slugified, case-insensitive
    // — link_index already carries basename/path/title slugs).
    // ponytail: scan caps at the 2000 most recently updated metadata rows;
    // raise or paginate if vaults outgrow that.
    const metaRows = db
      .query<{ note_path: string; entities: string }, []>(
        `SELECT note_path, entities FROM note_metadata
         WHERE entities IS NOT NULL
         ORDER BY updated_at DESC
         LIMIT 2000`,
      )
      .all();
    const mentions = new Map<string, { name: string; paths: Set<string> }>();
    for (const row of metaRows) {
      let entities: unknown;
      try {
        entities = JSON.parse(row.entities);
      } catch {
        continue;
      }
      if (!Array.isArray(entities)) continue;
      for (const e of entities) {
        const name =
          typeof e === "string"
            ? e
            : typeof (e as { name?: unknown })?.name === "string"
              ? (e as { name: string }).name
              : null;
        if (!name || name.trim().length === 0) continue;
        const key = name.trim().toLowerCase();
        const entry = mentions.get(key) ?? { name: name.trim(), paths: new Set() };
        entry.paths.add(row.note_path);
        mentions.set(key, entry);
      }
    }
    const hasSlug = db.query<{ ok: number }, [string]>(
      `SELECT 1 AS ok FROM link_index WHERE slug = ? COLLATE NOCASE LIMIT 1`,
    );
    const hasTitle = db.query<{ ok: number }, [string]>(
      `SELECT 1 AS ok FROM notes WHERE lower(title) = ? LIMIT 1`,
    );
    const entitiesWithoutPages: EntityFinding[] = [];
    for (const { name, paths } of mentions.values()) {
      if (paths.size < 3) continue;
      if (hasTitle.get(name.toLowerCase())) continue;
      const slug = slugify(name);
      if (slug.length > 0 && hasSlug.get(slug)) continue;
      entitiesWithoutPages.push({
        entity: name,
        mention_count: paths.size,
        sample_paths: Array.from(paths).sort().slice(0, 3),
      });
    }
    entitiesWithoutPages.sort(
      (a, b) => b.mention_count - a.mention_count || a.entity.localeCompare(b.entity),
    );

    // 4. Superseded notes still cited — targets of a `supersedes` lineage
    // edge (graph_edges.reason) that still receive edges of any kind
    // (cites/mentions/builds_on/...) from notes other than their
    // superseder(s). Those citations should usually move to the successor.
    const supersedes = db
      .query<{ source: string; target: string }, []>(
        `SELECT source, target FROM graph_edges WHERE reason = 'supersedes'`,
      )
      .all();
    const supersededBy = new Map<string, Set<string>>();
    for (const { source, target } of supersedes) {
      const set = supersededBy.get(target) ?? new Set();
      set.add(source);
      supersededBy.set(target, set);
    }
    const incomingStmt = db.query<{ source: string }, [string]>(
      `SELECT DISTINCT source FROM graph_edges WHERE target = ?`,
    );
    const supersededStillCited: SupersededFinding[] = [];
    for (const [target, superseders] of supersededBy) {
      const citing = incomingStmt
        .all(target)
        .map((r) => r.source)
        .filter((s) => !superseders.has(s) && s !== target)
        .sort();
      if (citing.length === 0) continue;
      supersededStillCited.push({
        path: target,
        superseders: Array.from(superseders).sort(),
        citing_paths: citing.slice(0, 10),
      });
    }
    supersededStillCited.sort((a, b) => a.path.localeCompare(b.path));

    // 5. Stale _inbox — notes still filed under project '_inbox' older than
    // the threshold. Age source order: ingest.ingested_at frontmatter (when
    // it was filed), then frontmatter created/modified (mirrored in the
    // notes table), then filesystem mtime. ponytail: caps at 500 inbox rows;
    // an inbox that big is its own finding.
    const inboxRows = db
      .query<
        { path: string; title: string | null; created: string | null; modified: string | null },
        []
      >(
        `SELECT path, title, created, modified FROM notes
         WHERE project = '_inbox' ORDER BY path LIMIT 500`,
      )
      .all();
    const staleInbox: StaleInboxFinding[] = [];
    for (const row of inboxRows) {
      let ts: number | null = null;
      const file = Bun.file(join(ctx.vaultDir, row.path));
      if (await file.exists()) {
        const { frontmatter } = parseFrontmatter(await file.text());
        const ingest = frontmatter.ingest;
        if (ingest && typeof ingest === "object" && !Array.isArray(ingest)) {
          ts = parseWhen((ingest as Record<string, unknown>).ingested_at);
        }
        ts ??= parseWhen(frontmatter.created) ?? parseWhen(frontmatter.modified);
        ts ??= file.lastModified;
      } else {
        // File unreadable (test DBs, mid-sync): fall back to the notes table.
        ts = parseWhen(row.created) ?? parseWhen(row.modified);
      }
      if (ts === null) continue;
      if (now - ts <= maxAgeDays * DAY_MS) continue;
      staleInbox.push({
        path: row.path,
        title: row.title,
        age_days: Math.floor((now - ts) / DAY_MS),
      });
    }
    staleInbox.sort((a, b) => b.age_days - a.age_days || a.path.localeCompare(b.path));

    const full: Record<FindingKey, unknown[]> = {
      orphans,
      broken_links: brokenLinks,
      entities_without_pages: entitiesWithoutPages,
      superseded_still_cited: supersededStillCited,
      stale_inbox: staleInbox,
    };
    const counts = {} as Record<FindingKey, number>;
    const truncated = {} as Record<FindingKey, boolean>;
    for (const key of FINDING_KEYS) {
      counts[key] = full[key].length;
      truncated[key] = full[key].length > LIST_CAP;
    }

    return {
      generated_at: new Date(now).toISOString(),
      counts,
      truncated,
      orphans: orphans.slice(0, LIST_CAP),
      broken_links: brokenLinks.slice(0, LIST_CAP),
      entities_without_pages: entitiesWithoutPages.slice(0, LIST_CAP),
      superseded_still_cited: supersededStillCited.slice(0, LIST_CAP),
      stale_inbox: staleInbox.slice(0, LIST_CAP),
    };
  },
};
