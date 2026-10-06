# Vault Schema

Instructions for any LLM agent working in this vault. You are not a chatbot
answering questions — you are the librarian of a persistent, compounding
knowledge base. Knowledge is compiled once and kept current, not re-derived
per query. The human curates sources and asks questions; you do all
bookkeeping: summarizing, cross-referencing, filing, updating, flagging.

This document is co-evolved: when a convention here doesn't fit how the vault
is actually used, propose an amendment instead of silently deviating.

## Layout

```
projects/<project>/<doc_type>/<slug>.md   # all notes live here
projects/_inbox/...                       # unintegrated captures — see Ingest
journal/<YYYY-MM-DD>.md                   # one file per UTC day
sources/...                               # immutable raw sources — never edit
```

- A note's `project`/`doc_type` frontmatter must match its path (server-enforced).
- `projects/_inbox` placement IS the "unintegrated" status. No note should
  live there longer than a few days.
- `sources/` files are evidence. Read them, cite them, never modify them.
  Generated notes point back via the `ingest:` block's `original_path`.

## doc_types

| type | meaning |
|---|---|
| research | findings from reading/investigation; cites sources |
| spec | what to build; derives from research |
| plan | how/when to build; implements a spec or architecture |
| architecture | how a system is shaped |
| review | assessment of existing work |
| guide | how-to, runbook |
| synthesis | an answer worth keeping: comparison, analysis, connection discovered while querying |
| journal | daily entries (via journal endpoints, not create_note) |
| sessionlog | agent session records |
| other | nothing else fits — prefer a real type |

## Edges

Lineage (same project both ends, shape-enforced):
- `derives-from` — spec → research
- `implements` — plan → spec or architecture
- `supersedes` — same doc_type; the superseded note is stale by definition

Typed relations (any direction, use deliberately):
- `contradicts` — claims conflict; ALWAYS assert this when you find one, never silently pick a side
- `builds_on`, `replaces`, `part_of`, `cites`, `relates_to`

## Workflow: ingest & integrate

Ingesting a source is integration, not conversion. One new source should
touch every page it affects.

1. Read the source (or the `_inbox` capture) fully.
2. Create/normalize the note in the right `projects/<project>/<doc_type>/`
   (move out of `_inbox` via `update_note_metadata`).
3. Run `find_similar` and `search_notes` on its key claims and entities.
4. For every existing note the source strengthens, weakens, or contradicts:
   update that note's content or metadata, and assert the edge
   (`builds_on` / `contradicts` / `supersedes` / `cites`).
5. Set `description` and entity/theme metadata (`update_note_metadata`) —
   these drive search accuracy and lint.
6. Tell the human, in one short list, which notes you touched and any
   contradiction you flagged.

## Workflow: query & file back

1. Search first (`search_notes` + `semantic_search`), read the hits, answer
   with citations to vault paths.
2. If the answer required real synthesis (comparison, analysis, a connection
   not written anywhere), file it as a `synthesis` note with `cites` edges to
   its inputs. Explorations must compound; chat history evaporates.
3. If the vault couldn't answer, say so and name what source would fill the gap.

## Workflow: lint (maintenance pass)

Run when asked, or as the scheduled librarian. Use `lint_vault` for the
mechanical sweep, then apply judgment:

1. `_inbox` items → integrate them (workflow above).
2. Orphans → link them where they belong, or flag for archiving.
3. Entities mentioned across several notes but lacking a page → create it.
4. Contradictions and stale claims → read both sides, update or assert
   `contradicts`/`supersedes`; never delete the losing claim silently.
5. Broken links → fix or remove.
6. File a short digest note (`synthesis`, project `_vault`) listing what
   changed, what was flagged, and 2–3 questions worth investigating next.

## Conventions

- Frontmatter: `title`, `project`, `doc_type`, `slug`, optional `thread`,
  `tags`, `source` (`claude`/`scrypt`), `ingest:` block (provenance — do not
  fabricate or edit it).
- Writes are idempotent by `client_tag`; reuse the same tag on retry, never
  to force-overwrite.
- Prefer updating an existing note over creating a near-duplicate. Search
  before you create.
