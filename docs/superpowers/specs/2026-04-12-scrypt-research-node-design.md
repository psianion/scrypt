# Scrypt as an Autonomous Research Node — Design

**Date:** 2026-04-12
**Status:** Approved (brainstorming)
**Scope:** Scrypt (knowledge server) only. Orchestrator, infra, mobile tooling are separate projects.

## 1. Goal

Turn Scrypt from a local markdown second-brain into a production-ready knowledge server that a separate Claude Orchestrator service can drive autonomously. The Orchestrator (not in scope for this spec) pulls research threads, runs Claude sessions, and writes findings back through Scrypt's REST API. Scrypt is the single source of truth for notes, threads, memories, and research logs.

The same pass also fixes a handful of daily-use rough edges that make Scrypt pleasant to read and navigate in the browser.

## 2. Background

Scrypt v0.1.0 shipped 30 tasks across 6 waves:
- Markdown vault with `[[wiki-links]]`, `#tags`, `- [ ] tasks`
- SQLite FTS5 search, graph view, backlinks panel
- Kanban, data explorer (CSV), tag browser, settings UI
- Notes CRUD, journal, templates, files, skills, plugins REST API
- Bun server with WebSocket live-reload

All 141 tests pass; all views render correctly against a real vault. The v0.1.0 API assumes a trusted localhost caller and doesn't expose the concepts the Orchestrator needs (threads, research runs, memories, ingest router, daily context).

The driving PRD describes a system where:
- Scrypt runs on an Oracle Cloud ARM VM (Always Free tier)
- A Claude Orchestrator runs alongside it in tmux
- A phone (Termux + Termius) is the remote console
- Tailscale provides the mesh network
- Telegram handles alerts

This spec covers only the Scrypt half. The Orchestrator, Tailscale, Termux, and Telegram integrations are separate projects that will be built after Scrypt is end-to-end usable.

## 3. Architecture

```
┌────────────────────────┐          ┌──────────────────────┐
│   Phone (Termux)       │          │   Oracle ARM VM      │
│   - Termius SSH        │ tailscale│                       │
│   - Manual triggers    │─────────▶│   tmux                │
│   - Telegram alerts    │          │   ├── scrypt server  │─── vault/
└────────────────────────┘          │   │   (this spec)    │    ├── notes/
                                    │   │   :3777          │    ├── journal/
                                    │   │                  │    ├── memory/
                                    │   ├── orchestrator   │    ├── docs/
                                    │   │   (separate)     │    └── .scrypt/scrypt.db
                                    │   │                  │
                                    │   └── claude code    │
                                    │       CLI            │
                                    └──────────────────────┘
```

Scrypt's boundaries don't change: it reads and writes markdown files in a vault directory and keeps a SQLite index of them. What changes is the API surface, the auth model, the data model (threads, research runs, memories, activity log), and the deployability.

## 4. Data model

### 4.1 Thread

A thread is a markdown note in `notes/threads/{slug}.md` representing an open research question. Frontmatter:

```yaml
---
title: "What's new in ARM SVE2 intrinsics for signal processing?"
kind: thread
status: open              # open | in-progress | resolved | failed | blocked | paused | archived
priority: 2               # 0=low, 1=normal, 2=high, 3=urgent
created: 2026-04-12T09:00:00.000Z
modified: 2026-04-12T09:00:00.000Z
source: claude            # claude | ui | import
tags: [thread, research/arm, signal-processing]
prompt: |
  Research recent additions to ARM SVE2 focused on DSP
  workloads. Prefer vendor blogs, conference talks,
  Reddit r/programming, HN, and arxiv.
context_notes: [[ARM overview]], [[SIMD history]]
last_run: null            # ISO timestamp of most recent research run, or null
run_count: 0              # how many runs have completed
---

# What's new in ARM SVE2 intrinsics for signal processing?

Free-form body: initial question, human-added context, open sub-questions.

## Runs
<!-- appended by POST /api/research_runs with newest first -->
```

**Status machine:** Transitions are unrestricted in v1 (any status → any status). The Orchestrator owns the lifecycle; Scrypt just stores whatever it sets.

### 4.2 Research run

A research run is a markdown note in `notes/research/{YYYY-MM-DD-HHMM}-{slug}.md` recording one Claude session's output for a thread. Frontmatter:

```yaml
---
title: "SVE2 intrinsics survey"
kind: research_run
thread: arm-sve2-intrinsics               # required; must reference an existing thread slug
status: success                            # success | partial | failed
started_at: 2026-04-12T03:14:00.000Z
completed_at: 2026-04-12T03:14:48.000Z
duration_ms: 48000
model: claude-opus-4-6
token_usage: { input: 12450, output: 3280 }
source: claude
created: 2026-04-12T03:14:48.000Z
modified: 2026-04-12T03:14:48.000Z
tags: [research_run]
---

# SVE2 intrinsics survey

Links: [[arm-sve2-intrinsics]]

## Summary
<short summary — the first 200 chars of this are what goes into the thread's ## Runs section>

## Findings
…long-form research output…

## Sources
- https://…
```

**Side effects** when a research run is created (see §6.3):
1. Row inserted into `research_runs` SQLite table (§4.4)
2. Thread note frontmatter updated: `last_run`, `run_count`, `modified`
3. Summary block appended to thread under `## Runs`

### 4.3 Memory

A memory is a markdown note in `memory/{slug}.md` representing a durable interest or preference profile. Memories are what Claude loads into every research prompt to know what kinds of content matter to you.

```yaml
---
title: "3D printing interest"
kind: memory
category: interest          # interest | preference | fact | relationship
active: true
priority: 2                 # higher priority memories are included first if token budget is tight
created: 2026-01-15T00:00:00.000Z
modified: 2026-04-12T09:00:00.000Z
tags: [memory, interest, making]
---

# 3D printing interest

Active interest in resin printing for tabletop miniatures and anime figures.
Own a Bambu A1 mini, ordered Anycubic Photon M3. Hobby budget ~$100/month.

## Focus areas
- Supportless models
- Miniatures for anime-inspired figures
- Custom posters printed on PETG

## Things to watch
- New resin printer releases under $500
- Free STL libraries for anime characters
- UV curing workflow improvements
```

Only memories where `active: true` are loaded into `daily_context`. Inactive memories are kept as historical record.

**Seed memory `memory/research-sources.md`** ships with the install and captures the user's preferred sources (Reddit subs, YouTube channels, tech blogs, HN, arxiv) so Claude always knows where to look.

### 4.4 Activity log (SQLite)

New table `activity_log`:

```sql
CREATE TABLE activity_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp  TEXT    NOT NULL,          -- ISO 8601 UTC w/ ms
  action     TEXT    NOT NULL,          -- create | update | delete | append | snapshot
  kind       TEXT,                      -- thread | research_run | note | ... | null for raw edits
  path       TEXT    NOT NULL,          -- vault-relative path
  actor      TEXT    NOT NULL,          -- claude | ui | watcher | system
  meta       TEXT                       -- JSON blob: request source, bytes, duration_ms, run_id?
);

CREATE INDEX idx_activity_timestamp ON activity_log(timestamp DESC);
CREATE INDEX idx_activity_actor ON activity_log(actor, timestamp DESC);
CREATE INDEX idx_activity_kind ON activity_log(kind, timestamp DESC);
```

Inserted on every write: `POST /api/ingest`, `PATCH /api/threads/:slug`, `POST /api/research_runs`, `PUT /api/notes/*path`, `DELETE /api/notes/*path`, and on file-watcher-detected hand edits (`actor: "watcher"`).

Append-only. Never auto-pruned. Queryable via `GET /api/activity`.

### 4.5 Research runs table (SQLite)

New table `research_runs` gives the Orchestrator a fast, queryable history:

```sql
CREATE TABLE research_runs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_slug   TEXT    NOT NULL,
  note_path     TEXT    NOT NULL,        -- path to the research_run markdown file
  status        TEXT    NOT NULL,        -- success | partial | failed
  started_at    TEXT    NOT NULL,
  completed_at  TEXT,
  duration_ms   INTEGER,
  model         TEXT,
  tokens_in     INTEGER,
  tokens_out    INTEGER,
  error         TEXT
);

CREATE INDEX idx_runs_thread ON research_runs(thread_slug, started_at DESC);
CREATE INDEX idx_runs_status ON research_runs(status, started_at DESC);
```

The markdown file is the human-readable artifact; the DB row is the machine-readable index. They are written together in one transaction.

### 4.6 Server-owned timestamps

Every note carries two frontmatter timestamps, both set by the server and never trusted from the client:

- `created` — set once on first write; never modified thereafter
- `modified` — bumped on every content-or-frontmatter change

Both use ISO 8601 UTC with millisecond precision: `2026-04-12T03:14:00.123Z`. The indexer prefers these over filesystem `mtime`, falling back to mtime only when both are absent.

## 5. API surface

### 5.1 Auth

- Single Bearer token read from `SCRYPT_AUTH_TOKEN` env var at startup
- If the env var is unset, the server refuses to start in production mode (`NODE_ENV=production`)
- Every `/api/*` request requires `Authorization: Bearer <token>`
- **Dev bypass:** when `NODE_ENV !== "production"`, localhost requests (`127.0.0.1` / `::1`) are allowed without auth so the browser UI keeps working. Non-localhost requests in dev mode still require the token if it is set; if the token is unset in dev, external requests get `401`.
- `401` with empty body on missing/wrong token (no hint leakage)
- Static file serving (SPA shell at `/`, `/assets/*`, `index.html`) is not auth-gated — the shell needs to load before it can send its own Bearer token for API calls

### 5.2 Read endpoints

```
GET  /api/threads                                  # list threads
     ?status=open,in-progress&priority=2&tag=foo&limit=50    # filters; status accepts comma-separated list
GET  /api/threads/:slug                             # single thread with full content + run list
GET  /api/research_runs                             # list runs
     ?thread=arm-sve2&status=success&since=2026-04-10T00:00:00Z&limit=20
GET  /api/memories                                  # list memories
     ?active=true&category=interest
GET  /api/daily_context                             # bundle (see §5.4)
GET  /api/activity                                  # activity log
     ?since=2026-04-12T00:00:00Z&actor=claude&kind=research_run&limit=100

# existing endpoints — now auth-gated
GET  /api/search?q=
GET  /api/notes/*path
GET  /api/backlinks/*path
GET  /api/graph
GET  /api/journal/today
GET  /api/journal/:date
GET  /api/tasks
GET  /api/data
GET  /api/data/*file
GET  /api/plugins
GET  /api/skills
GET  /api/files/*path
```

### 5.3 Write endpoints

```
POST  /api/ingest                    # smart router — primary write path (see §6)
PATCH /api/threads/:slug              # partial update: status, priority, prompt, last_run, run_count
POST  /api/research_runs              # log a run (DB row + research_run note + thread sync)

# existing — now auth-gated
POST   /api/notes                     # direct note creation (hand-authored via UI)
PUT    /api/notes/*path               # direct note edit
DELETE /api/notes/*path                # soft-delete to .scrypt/trash/
POST   /api/tasks                      # existing
POST   /api/files/upload               # existing
```

### 5.4 `GET /api/daily_context` response shape

```json
{
  "generated_at": "2026-04-12T03:14:00.123Z",
  "today": {
    "date": "2026-04-12",
    "journal": { "path": "journal/2026-04-12.md", "content": "…", "exists": true }
  },
  "recent_notes": [
    {
      "path": "notes/welcome.md",
      "title": "Welcome to Scrypt",
      "modified": "2026-04-12T02:50:00.000Z",
      "tags": ["intro", "project"],
      "snippet": "first 200 chars of body (after frontmatter), whitespace-collapsed"
    }
  ],
  "open_threads": [
    {
      "slug": "arm-sve2-intrinsics",
      "title": "What's new in ARM SVE2…",
      "status": "open",
      "priority": 2,
      "last_run": null,
      "prompt": "…",
      "path": "notes/threads/arm-sve2-intrinsics.md"
    }
  ],
  "active_memories": [
    {
      "slug": "3d-printing-interest",
      "title": "3D printing interest",
      "category": "interest",
      "priority": 2,
      "content": "…full markdown body so Claude can use it directly…"
    }
  ],
  "tag_cloud": [
    { "tag": "project/scrypt", "count": 42 },
    { "tag": "research", "count": 17 }
  ]
}
```

Filters baked in:
- `recent_notes` — notes modified in the last 24h, limit 20, sorted descending
- `open_threads` — `status IN (open, in-progress, blocked)`, sorted by `priority DESC, last_run ASC` (oldest neglected threads first)
- `active_memories` — `active: true`, sorted by `priority DESC`
- `tag_cloud` — top 20 by count

### 5.5 `POST /api/ingest` contract (the primary write path)

**Request:**
```json
{
  "kind": "research_run",
  "title": "SVE2 intrinsics survey",
  "content": "# SVE2 intrinsics survey\n\nLinks: [[arm-sve2-intrinsics]]\n\n## Summary\n…",
  "frontmatter": {
    "thread": "arm-sve2-intrinsics",
    "status": "success",
    "started_at": "2026-04-12T03:14:00.000Z",
    "completed_at": "2026-04-12T03:14:48.000Z",
    "duration_ms": 48000,
    "model": "claude-opus-4-6",
    "token_usage": { "input": 12450, "output": 3280 }
  },
  "replace": false
}
```

**Response (success):**
```json
{
  "path": "notes/research/2026-04-12-0314-sve2-intrinsics-survey.md",
  "kind": "research_run",
  "created": true,
  "side_effects": {
    "thread_updated": "notes/threads/arm-sve2-intrinsics.md",
    "research_run_id": 42
  }
}
```

**Errors:**
- `400` — unknown `kind`, missing required field, unknown `thread` for a `research_run`
- `401` — missing/wrong Bearer token
- `409` — file already exists and `replace: false`
- `500` — filesystem or DB error

### 5.6 `PATCH /api/threads/:slug` contract

```json
{
  "status": "in-progress",
  "priority": 3,
  "last_run": "2026-04-12T03:14:48.000Z",
  "run_count": 1
}
```

Only the fields in the body are updated. Server refuses unknown fields with `400`.

### 5.7 `POST /api/research_runs` contract

Thin wrapper that:
1. Calls `POST /api/ingest` with `kind: research_run`
2. Inserts the `research_runs` table row (with `id`)
3. Triggers thread-update side effects (see §6.3)
4. Returns the combined result

Rationale: the Orchestrator can call `/api/ingest` directly, but `/api/research_runs` is the documented happy path and keeps the PRD contract clean.

## 6. Smart ingest router

### 6.1 Kind → folder table

| `kind`         | Folder              | Filename pattern                              |
|----------------|---------------------|-----------------------------------------------|
| `thread`       | `notes/threads/`    | `{slug}.md`                                   |
| `research_run` | `notes/research/`   | `{YYYY-MM-DD-HHMM}-{slug}.md`                 |
| `memory`       | `memory/`           | `{slug}.md`                                   |
| `spec`         | `docs/specs/`       | `{YYYY-MM-DD}-{slug}.md`                      |
| `plan`         | `docs/plans/`       | `{YYYY-MM-DD}-{slug}.md`                      |
| `note`         | `notes/inbox/`      | `{slug}.md`                                   |
| `log`          | `notes/logs/`       | `{YYYY-MM-DD}-{slug}.md`                      |
| `thought`      | `notes/thoughts/`   | `{YYYY-MM-DD-HHMM}-{slug}.md`                 |
| `idea`         | `notes/ideas/`      | `{slug}.md`                                   |
| `journal`      | `journal/`          | `{YYYY-MM-DD}.md` (append, never overwrite)   |

All timestamps in UTC. `HHMM` suffixes prevent same-day collisions on runs, thoughts, and logs.

### 6.2 Slug generation

```
"What's new in ARM SVE2?"  →  "whats-new-in-arm-sve2"
```

Rules:
1. Lowercase
2. Replace whitespace and underscores with `-`
3. Strip characters outside `[a-z0-9-]`
4. Collapse repeated `-`, trim leading/trailing `-`
5. Max 60 characters, cut at last word boundary
6. On collision, append `-2`, `-3`, etc. until unique

### 6.3 Kind-specific side effects

**`research_run`**:
1. Validate `frontmatter.thread` references an existing thread slug. If not, `400`.
2. Write the research run markdown file.
3. Insert `research_runs` row with generated `id`.
4. Update the thread note:
   - Frontmatter: `last_run = completed_at`, `run_count += 1`, `modified = now`
   - Body: append summary block under `## Runs` (creating the section if missing):
     ```markdown
     ### 2026-04-12 03:14 — [[2026-04-12-0314-sve2-intrinsics-survey]]
     <first 200 chars of run's ## Summary section, or first 200 chars of body if no Summary>
     ```
5. Emit two `activity_log` rows (one for the run note, one for the thread update).

All steps run in a SQLite transaction; if any step fails, the file write is rolled back by deleting the written file (best-effort).

**`journal`**:
1. Compute today's path: `journal/{YYYY-MM-DD}.md` (UTC).
2. If it exists, append content under a `## {HH:MM UTC}` heading.
3. If it doesn't exist, create it from `templates/daily.md` (with `{date}`, `{title}`, `{now}` substitutions), then append.
4. Emit one `activity_log` row with `action: append` or `action: create`.

**`thread`**:
1. Validate `status` is in the enum. Default to `open` if missing.
2. Write the file normally. No further side effects — the thread becomes discoverable through `GET /api/threads`.

**`memory`**:
1. Default `active: true` if not specified.
2. Default `category: interest` if not specified.
3. Write the file normally.

**All other kinds:** write the file, emit one `activity_log` row. The file watcher picks it up via the existing indexer pipeline.

### 6.4 Auto-injected frontmatter

Every ingested note has these fields merged on top of caller-provided frontmatter:
```yaml
kind: <from request>
created: <ISO UTC, now>      # server-owned, caller cannot override
modified: <ISO UTC, now>     # server-owned, caller cannot override
source: <endpoint-derived>   # server-owned; see table below
```

`source` is determined by the endpoint used, not by the caller:

| Endpoint                                           | `source`  |
|----------------------------------------------------|-----------|
| `POST /api/ingest`                                  | `claude`  |
| `POST /api/research_runs`                           | `claude`  |
| `PATCH /api/threads/:slug`                          | (unchanged on update) |
| `POST /api/notes`, `PUT /api/notes/*path` (UI)     | `ui`      |
| File watcher picking up a hand-edit                 | `watcher` |

If the caller tries to set `created`, `modified`, or `source`, the server silently ignores those values.

### 6.5 Error behavior

| Condition                                      | Status | Body                                       |
|------------------------------------------------|--------|--------------------------------------------|
| Missing `kind`, `title`, or `content`          | 400    | `{ error, field }`                         |
| Unknown `kind`                                  | 400    | `{ error, valid_kinds: [...] }`           |
| Unknown `thread` on `research_run`              | 400    | `{ error, field: "frontmatter.thread" }`  |
| File exists, `replace: false`                   | 409    | `{ error, existing_path }`                 |
| Missing/wrong Bearer token                      | 401    | (empty)                                    |
| Filesystem / DB failure                         | 500    | `{ error: "Internal error" }` (logged)    |

## 7. Maintenance & tracking

### 7.1 Git autocommit (opt-in)

When `SCRYPT_GIT_AUTOCOMMIT=1`:
- On startup, `git init` the vault if not already a repo; write a sensible `.gitignore` excluding `.scrypt/scrypt.db*`
- Every `SCRYPT_GIT_AUTOCOMMIT_INTERVAL` seconds (default 900 = 15 min), commit any pending changes:
  ```
  git add -A && git commit -m "scrypt snapshot <ISO timestamp>"
  ```
- No remotes, no pushes — purely local version history
- Each successful commit emits **one aggregate** `activity_log` row with `action: snapshot`, `path` set to the vault root, and `meta` containing the commit SHA and file count (not one row per changed file)
- Failures are logged and skipped; never crash the server

This gives free time-travel recovery without a separate backup system.

### 7.2 Maintenance CLI

`bun src/server/cli.ts maintenance` (also callable as the entry point of a subcommand):

1. Prune `.scrypt/trash/` entries older than `SCRYPT_TRASH_RETENTION_DAYS` (default 30)
2. `VACUUM` the SQLite DB
3. Check FTS5 index integrity; rebuild if drifted
4. Emit `activity_log` row summarizing the run

Wired externally via cron:
```
0 3 * * * cd /path/to/vault && SCRYPT_VAULT_PATH=/path/to/vault bun /path/to/scrypt/src/server/cli.ts maintenance
```

Not called by the server process itself — the server stays single-responsibility.

### 7.3 No read-side accessed tracking

Deliberate. Every GET writing to the DB would turn Scrypt into a chatty database and defeat the point of FTS5 being fast. The write-side activity log is the proxy for engagement.

## 8. Browser UI polish

Folded into this spec since they're small and the same pass touches the code.

1. **Tag parser fix** (`src/server/parsers.ts`):
   - Require at least one non-digit character after `#` to be a tag
   - Skip hex color patterns: `#[0-9a-f]{3}\b` and `#[0-9a-f]{6,8}\b`
   - Rewrite fence-skipping to walk lines tracking fence state rather than regex-stripping blocks
   - Add unit tests for: `#fff`, `#333333`, `#1.`, `#1st`, `#tag`, tags inside fences

2. **Default route** (`src/client/App.tsx`):
   - `/` redirects to `/journal`
   - Sidebar "Journal" is selected when on `/` or `/journal`
   - Add a `Notes` route at `/notes` that renders a real notes list (see below)

3. **Notes list view** (`src/client/views/NotesList.tsx`, new):
   - Route: `/notes`
   - Columns: title, folder, tags, modified
   - Sort options: modified (default), created, title
   - Filter: tag multi-select, folder single-select
   - Row click opens the note in the editor

4. **Sidebar file list grouping** (`src/client/components/Sidebar.tsx`):
   - The sidebar has two regions: top nav (Notes/Journal/Tasks/Graph/Data/Tags/Settings) and bottom "Files" list. This change **only affects the bottom Files list**, not the top nav.
   - Replace the flat Files list with collapsible sections grouped by folder: `Threads`, `Research`, `Memory`, `Inbox`, `Ideas`, `Thoughts`, `Logs`, `Docs`
   - Within each section, sort by modified desc, limit to 20 entries, "see all" link routes to `/notes?folder=X`
   - Empty sections are hidden

5. **Research & thread views** (lightweight — reuse Editor):
   - No dedicated routes. Threads and research runs are just markdown notes and open in the editor like any other note. The graph view and backlinks panel do the heavy lifting for navigation.

## 9. Deployment

### 9.1 Dockerfile

Multi-stage, final image on `oven/bun:1-slim`:
```dockerfile
FROM oven/bun:1 AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

FROM oven/bun:1-slim
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=build /app/src ./src
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./
ENV NODE_ENV=production
EXPOSE 3777
USER bun
CMD ["bun", "src/server/index.ts"]
```

Must build cleanly on aarch64. Final image target: ≤100 MB.

### 9.2 docker-compose.yml

```yaml
services:
  scrypt:
    build: .
    restart: unless-stopped
    ports:
      - "3777:3777"
    environment:
      - SCRYPT_AUTH_TOKEN=${SCRYPT_AUTH_TOKEN}
      - SCRYPT_VAULT_PATH=/vault
      - SCRYPT_GIT_AUTOCOMMIT=1
      - NODE_ENV=production
    volumes:
      - ./vault:/vault
```

### 9.3 systemd unit (alternative)

`systemd/scrypt.service` for running without Docker on the 1GB Ampere instance:
```ini
[Unit]
Description=Scrypt knowledge server
After=network.target

[Service]
Type=simple
User=scrypt
WorkingDirectory=/home/scrypt/vault
EnvironmentFile=/etc/scrypt/scrypt.env
ExecStart=/home/scrypt/.bun/bin/bun /opt/scrypt/src/server/index.ts
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

### 9.4 Environment variables

| Var                                | Default         | Purpose                                        |
|------------------------------------|-----------------|------------------------------------------------|
| `SCRYPT_AUTH_TOKEN`                | (required)      | Bearer token for all `/api/*` calls            |
| `SCRYPT_VAULT_PATH`                | `cwd`           | Path to the vault directory                    |
| `SCRYPT_PORT`                      | `3777`          | HTTP port                                       |
| `SCRYPT_STATIC_DIR`                | `{vault}/dist`  | SPA shell location                              |
| `SCRYPT_GIT_AUTOCOMMIT`            | `0`             | Enable git-backed version history               |
| `SCRYPT_GIT_AUTOCOMMIT_INTERVAL`   | `900`           | Seconds between auto-commits                    |
| `SCRYPT_TRASH_RETENTION_DAYS`      | `30`            | Maintenance CLI prune threshold                 |
| `SCRYPT_LOG_LEVEL`                 | `info`          | `debug | info | warn | error`                  |
| `NODE_ENV`                         | (unset)         | `production` disables localhost auth bypass     |

A `.env.example` ships at the repo root.

### 9.5 README deployment section

New section: "Deploying to Oracle ARM". Exact commands for:
- Provisioning an Always Free Ampere A1 VM
- Installing Bun on ARM
- Cloning Scrypt
- Creating the auth token
- `docker compose up -d` OR enabling the systemd unit
- Opening port 3777 in Oracle's security list (or leaving it Tailscale-only)
- Smoke-testing with `curl -H "Authorization: Bearer $TOKEN" https://…/api/daily_context`

**No Tailscale, Oracle provisioning scripts, or cloud automation** — that's a separate runbook.

## 10. Out of scope

Explicitly not built in this spec, even though they're part of the broader PRD:

- **The Claude Orchestrator service** — the thing that pulls threads, runs Claude, and writes findings back. Separate Bun project in its own repo. This spec defines the contract it will call against.
- **Tailscale configuration** — infrastructure, done manually.
- **Termux / Termius scripts** — phone-side tooling.
- **Telegram bot alerts** — notifications layer, separate.
- **Oracle VPS provisioning** — manual runbook, not code.
- **Claude quota/rate tracking** — the Orchestrator's job.
- **Research run scheduling** — handled by cron + the Orchestrator.
- **Multi-user auth** — single Bearer token only. If this becomes multi-user, it's a later redesign.
- **Read-side access logging** — deliberately skipped (§7.3).
- **Live markdown preview in the editor** — wanted for daily use but bigger scope; separate polish pass.

## 11. Success criteria

Scrypt is "done" for this spec when:

1. `bun run test` → all server and client tests pass (existing 141 + new tests for §4–§7)
2. `SCRYPT_AUTH_TOKEN=foo bun src/server/index.ts` → server refuses unauthenticated `/api/*` calls in production mode; accepts them with the correct Bearer header
3. `POST /api/ingest` with each of the 10 kinds creates the file in the right folder with the right filename
4. `POST /api/research_runs` creates a run note, inserts a DB row, updates the linked thread, and appends the summary block
5. `GET /api/daily_context` returns a non-empty bundle for a seeded vault with one thread, one memory, and a journal entry
6. `GET /api/activity` returns the write history with filters working
7. `docker compose up -d` on an aarch64 host brings Scrypt up and answers `/api/daily_context` correctly
8. `#fff` and `#333333` in markdown content are **not** picked up as tags
9. The browser UI renders a proper notes list at `/notes`, and `/` goes to the journal
10. A Claude session running against the local API can: read an open thread → write a research run → see the thread updated in the graph view → read it back via `GET /api/threads/:slug` with the run visible

When all 10 are green, Scrypt is ready for the Orchestrator to be built against it.
