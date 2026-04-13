# Scrypt

> A personal second brain for the AI era. Markdown on disk, SQLite-indexed, with a browser UI and a REST API that humans and LLMs both talk to.

Scrypt is the memory layer for how I work. Every project, research thread, interest, and half-baked idea lives here as a `.md` file, and Claude reads and writes into the same vault I do. The result is a knowledge base that keeps its own context across sessions instead of starting from scratch every time I open a new chat.

![Editor with backlinks](assets/screenshots/editor.png)

## What it's for

- **A single place to hold the context of every project.** Specs, plans, research notes, decisions, loose ideas — all linked together as markdown. The graph view makes the shape of what you're building visible.
- **A memory Claude (or any LLM) can read and write.** The REST API gives an agent structured access to the whole vault: pull open threads, fetch linked context, search across everything, drop a research run back. Your notes stop being a dead archive and become live context.
- **A domain-aware knowledge graph.** Notes declare their `domain:` and `subdomain:` up front, the ingester routes them into a nested folder structure on disk, and the graph connects them along four axes at once: wiki-links, shared subdomain, shared domain, shared identifier tags (`type:research`, `project:longrest`, `stage:draft`).
- **A shared workspace for parallel Claude sessions.** Run multiple Claude tmux windows at once — one researching, one writing, one reviewing — all pointed at the same vault. The graph and backlinks mean those independent sessions still weave into one coherent knowledge base instead of fragmenting into silos.
- **Scriptable end to end.** Every feature is available over HTTP. Cron jobs, shell scripts, Claude agents, and custom tools all drive the same API.

## How I run it

It's just a Bun process reading a folder of markdown, so it runs anywhere Bun runs. Two common setups:

**Local (Docker Desktop on your laptop).** Fastest path to a working install. Scrypt runs as a container while your laptop is on, your orchestrator talks to `localhost:3777`, and the vault lives in a folder like `~/scrypt-vault` that any editor can open. Auto-starts on login if Docker Desktop is set to.

**Remote (Oracle Cloud Always Free ARM).** For 24/7 availability — research loops while you sleep, phone access when your laptop is closed. Ampere A1 instance, Tailscale for private access, same Docker Compose setup. Never exposed to the public internet.

You can do the same thing on a Raspberry Pi, a spare laptop, or just localhost. The server has no idea where it's running — it just indexes the folder you point it at.

## What you get

| | |
|---|---|
| **Editor** | CodeMirror 6 with markdown syntax, auto-save, `Cmd+S`, dark theme |
| **Links** | `[[wiki-links]]` resolved across folders, automatic backlinks panel, clickable navigation |
| **Graph** | D3 force-directed graph with 4 edge types (wiki-link, subdomain, domain, shared tag), hover neighbor highlight, zoom/pan, filter toggles |
| **Sidebar folder tree** | Nested folder tree mirroring the vault, filesystem-driven, with expand-state persistence |
| **Drop upload** | Drag a `.md` or image onto `/notes` — parsed frontmatter routes it into the right folder automatically |
| **New note modal** | `Cmd+N` or the sidebar `+` button opens a form with domain/subdomain/tags pickers |
| **Journal related panel** | Today's journal pane shows related notes, active memories, and draft prompts pulled from `/api/daily_context` |
| **Search** | SQLite FTS5 full-text search with BM25 ranking, `<b>`-highlighted snippets, live results |
| **Kanban** | Every `- [ ]` task across your vault on a drag-and-drop board |
| **Data** | Drop a `.csv` or `.xlsx` in `data/`, get a sortable table preview |
| **Tags** | `#tag` + namespaced identifier tags (`type:research`) with a hierarchical browser |
| **Command palette** | `Cmd+K` fuzzy search across every note |
| **REST API** | Full read/write surface — notes, search, graph, tasks, daily_context, ingest, threads, memories, activity |
| **Git autocommit** | Opt-in background loop records vault history (15-min interval) |
| **Live reload** | External edits (git pull, another editor, `cp`) appear in the UI instantly |

![Graph view](assets/screenshots/graph.png)

## Built with

- **[Bun](https://bun.sh)** — runtime, bundler, test runner, SQLite driver, HTTP server
- **React 19 + Vite + Tailwind** — client
- **CodeMirror 6** — editor
- **D3** — graph rendering (force, zoom, drag, selection)
- **SQLite FTS5** — index and search
- **Zustand** — client state
- **`@dnd-kit`** — kanban drag-and-drop
- **gray-matter** — frontmatter parsing

Zero runtime dependencies beyond Bun. No Node, no npm, no database server to install.

## Who it's for

- **You, if you like markdown** and want something more capable than "a folder of files" without locking your data in a cloud app.
- **Developers** who want to drive a knowledge base from scripts — dump research notes from a curl call, query the graph from a cron job, build a custom view on top of the API.
- **Anyone building with Claude or another LLM** who needs a scriptable place to write and read notes. Every endpoint takes JSON in, returns JSON out, and the vault is plain markdown you can still edit by hand.

## Quick start — Docker Desktop (recommended)

The fastest path from zero to running. Works on macOS, Windows, Linux.

```bash
git clone https://github.com/psianion/scrypt.git
cd scrypt

# Create your vault outside the repo so rebuilds never touch it
mkdir -p ~/scrypt-vault

# Set up .env
cp .env.example .env
# Edit .env and set:
#   SCRYPT_AUTH_TOKEN=$(openssl rand -hex 32)
#   SCRYPT_VAULT_DIR=/Users/you/scrypt-vault   # absolute path
#   SCRYPT_GIT_AUTOCOMMIT=1

# Boot
docker compose up -d --build
docker compose logs -f scrypt    # confirm: "Scrypt running on http://localhost:3777"
```

Open <http://localhost:3777>. Drop markdown files into `~/scrypt-vault/` from Finder, VS Code, or `cp` — they appear in the UI within 200 ms.

**Auto-start at login.** Docker Desktop → Settings → General → ✅ *Start Docker Desktop when you log in*. Combined with `restart: unless-stopped` in `docker-compose.yml`, Scrypt will be up every time you boot your laptop.

See `docs/BUILD_AND_RUN.md` for every other run mode (dev with hot reload, systemd, Oracle ARM, Raspberry Pi).

## Quick start — Bun (no Docker)

```bash
bun install
bun run build

export SCRYPT_AUTH_TOKEN=$(openssl rand -hex 32)
export SCRYPT_VAULT_PATH=~/scrypt-vault
mkdir -p ~/scrypt-vault
bun src/server/index.ts
```

Open <http://localhost:3777>.

## Writing a note

Every note is a markdown file with optional YAML frontmatter. Minimum:

```markdown
---
title: Welcome
---

# Welcome

Your first note.
```

For the domain-aware graph and folder routing, declare a domain and subdomain:

```markdown
---
title: DnD Landing Page Strategy
domain: dnd                  # top-level folder
subdomain: research          # subfolder under the domain
tags:
  - type:research            # namespaced identity tag — linked in graph
  - project:longrest         # namespaced identity tag
  - stage:draft              # namespaced identity tag
  - landing-page             # flat topic tag
  - cta                      # flat topic tag
---

# Strategy

Link to [[p2p-vs-saas-vtt-analysis]] and it'll show up in the backlinks
panel of that note automatically. The graph will connect us via:
- the wiki-link edge (strong)
- the shared `subdomain: research` under `domain: dnd` (medium)
- the shared `project:longrest` tag (medium)

- [ ] Publish landing v2
- [x] Competitor analysis
```

Drop this file into `~/scrypt-vault/notes/inbox/welcome.md` (or POST it to `/api/ingest` — see below). On save, the ingest router puts it at `dnd/research/dnd-landing-page-strategy.md`, the watcher indexes it, the backlinks panel fills in, and the graph edges appear.

## Using it in the browser

| Route | Shows |
|---|---|
| `/` | Redirects to `/journal` |
| `/journal` | Today's daily note with a "Related" right-rail (notes, memories, draft prompts) |
| `/notes` | All notes with sort + tag filter + drag-drop upload |
| `/graph` | Interactive D3 force-directed graph with per-edge-type filter toggles |
| `/tasks` | Kanban board of every inline task |
| `/data` | CSV/XLSX browser with sortable preview |
| `/tags` | Hierarchical tag tree with counts |
| `/search` | Live full-text search |
| `/settings` | Editor preferences |
| `/note/*path` | Edit any note |

**Shortcuts:** `Cmd+K` opens the command palette, `Cmd+N` opens the new-note modal, `Cmd+S` saves the current note.

**Sidebar:** `+ New note` at the top, main navigation, then a filesystem-mirrored folder tree (`dnd/research/...`, `scrypt-dev/specs/...`). Folders persist their expand state across sessions. Empty folders auto-hide.

![Kanban board](assets/screenshots/kanban.png)

## Using it from the API

The browser UI talks to the same REST API your scripts will. JSON in, JSON out. Every route in production requires a bearer token:

```
Authorization: Bearer <your-SCRYPT_AUTH_TOKEN>
```

In dev mode (not `NODE_ENV=production`), localhost requests bypass auth for convenience. Full endpoint reference lives in `docs/API.md`.

### Ingest a note

The smartest write path — respects frontmatter `domain`/`subdomain` routing, returns the canonical path.

```bash
curl -X POST http://localhost:3777/api/ingest \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "kind": "note",
    "title": "Smoke test",
    "content": "hello from curl",
    "frontmatter": {
      "domain": "scrypt-dev",
      "subdomain": "smoke",
      "tags": ["type:test"]
    }
  }'
# → { "path": "scrypt-dev/smoke/smoke-test.md", "slug": "smoke-test" }
```

### Get today's orchestrator context bundle

One call that gives an LLM everything it needs to start a session: today's journal entry, open threads, active memories, recent notes, tag cloud, and related items.

```bash
curl -H "Authorization: Bearer $TOKEN" http://localhost:3777/api/daily_context | jq .
```

### Search

```bash
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3777/api/search?q=architecture"
```

### Graph as JSON

```bash
curl -H "Authorization: Bearer $TOKEN" http://localhost:3777/api/graph | jq '.edges | group_by(.type) | map({type: .[0].type, count: length})'
```

### Full endpoint map

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/ingest` | Primary write path — routes by frontmatter `kind`/`domain`/`subdomain` |
| `GET` | `/api/notes` | List notes with `?tag`, `?folder`, `?sort` filters |
| `GET` | `/api/notes/*path` | Read a note with frontmatter + backlinks |
| `POST` | `/api/notes` | Create a note (lower-level than `/api/ingest`) |
| `PUT` | `/api/notes/*path` | Update a note |
| `DELETE` | `/api/notes/*path` | Soft-delete to `.scrypt/trash/` |
| `GET` | `/api/daily_context` | Orchestrator daily bundle (journal + threads + memories + related) |
| `GET` | `/api/threads` | List research threads (`?status`, `?priority`) |
| `GET` | `/api/threads/:slug` | Read one thread with content |
| `PATCH` | `/api/threads/:slug` | Update thread status, priority, run_count |
| `POST` | `/api/research_runs` | Record an LLM research run |
| `GET` | `/api/research_runs` | List runs (`?thread`, `?status`, `?since`) |
| `GET` | `/api/memories` | List memory profiles (`?active`, `?category`) |
| `GET` | `/api/activity` | Write history (`?kind`, `?actor`, `?limit`, `?since`, `?until`) |
| `GET` | `/api/search?q=` | Full-text search with FTS5 |
| `GET` | `/api/search/tags?q=` | Tag completion |
| `GET` | `/api/graph` | Whole-vault graph with 4 edge types |
| `GET` | `/api/graph/*path?depth=N` | Local subgraph walk |
| `GET` | `/api/backlinks/*path` | Notes linking to this one |
| `GET` | `/api/journal/today` | Today's note (auto-create from template) |
| `GET` | `/api/journal/:date` | Entry for a specific date |
| `GET` | `/api/templates` | List templates |
| `POST` | `/api/templates/apply` | Create a note from a template |
| `GET` | `/api/tasks` | Inline tasks (`?board`, `?done`, `?tag`) |
| `PUT` | `/api/tasks/:id` | Update task state |
| `GET` | `/api/data` | List CSV/XLSX files |
| `GET` | `/api/data/*file` | Parsed CSV as JSON |
| `GET` | `/api/data/*file/schema` | Headers, types, row count |
| `POST` | `/api/files/upload` | Upload an asset (image, PDF) |
| `GET` | `/api/files/*path` | Serve an uploaded asset |
| `GET` | `/api/plugins` | List installed plugins |
| `GET` | `/api/skills` | List skill definitions |

![Full-text search](assets/screenshots/search.png)

## Vault layout

Any `.md` file anywhere under the vault is indexed. Scrypt picks the folder based on your frontmatter; if you omit `domain`/`subdomain`, it falls back to a `kind`-based convention (specs → `docs/specs/`, plans → `docs/plans/`, notes → `notes/inbox/`, etc).

```
~/scrypt-vault/
├── dnd/                        ← domain: dnd
│   ├── research/               ← subdomain: research
│   │   ├── post-map-runner.md
│   │   └── p2p-vs-saas.md
│   └── plans/
│       └── landing-v2.md
├── scrypt-dev/                 ← domain: scrypt-dev
│   ├── specs/
│   └── plans/
├── notes/
│   └── inbox/                  ← fallback for notes without a domain
├── journal/                    ← daily entries (YYYY-MM-DD.md)
├── memory/                     ← active interest profiles for orchestrator context
├── data/                       ← CSV/XLSX files, browsable in the Data view
├── templates/                  ← markdown templates with {date}, {title}, {now}
├── assets/                     ← uploaded images and attachments
└── .scrypt/                    ← Scrypt's own state (gitignored)
    ├── scrypt.db               SQLite index — regenerated if deleted
    └── trash/                  Soft-deleted notes
```

![CSV preview in Data view](assets/screenshots/data-csv.png)

## Environment variables

Full catalog and how they flow through `.env` → `docker-compose.yml` → `src/server/config.ts` lives in `docs/BUILD_AND_RUN.md`. Quick reference:

| Var | Default | Required? |
|---|---|---|
| `SCRYPT_AUTH_TOKEN` | — | **Yes** in production |
| `SCRYPT_VAULT_PATH` | `process.cwd()` | Yes — path inside the container |
| `SCRYPT_VAULT_DIR` | `./vault` | Compose-only — host path mounted as `/vault` |
| `SCRYPT_STATIC_DIR` | `{vault}/dist` | Yes under Docker — point at `/app/dist` |
| `SCRYPT_PORT` | `3777` | No |
| `NODE_ENV` | `development` | Set to `production` in deployment |
| `SCRYPT_GIT_AUTOCOMMIT` | `0` | Opt-in (`1` enables the 15-min loop) |
| `SCRYPT_GIT_AUTOCOMMIT_INTERVAL` | `900` | Seconds between autocommits |
| `SCRYPT_TRASH_RETENTION_DAYS` | `30` | Nightly cron deletes older trash |
| `SCRYPT_LOG_LEVEL` | `info` | `debug \| info \| warn \| error` |

## Development

```bash
bun install
bun run dev           # server with hot reload on :3777
bun run dev:client    # Vite on :5173 for the React side
bun run test          # full suite (server + client) — currently 358 pass / 0 fail
bun run build         # production client bundle
bunx tsc --noEmit     # type check — currently 0 errors
```

```
src/
├── server/                   Bun server — API, indexer, watcher, WebSocket
│   ├── api/                  REST route handlers (one file per endpoint group)
│   ├── ingest/               IngestRouter + kind-specific path resolvers
│   ├── db.ts                 SQLite schema, FTS5, migrations
│   ├── indexer.ts            Two-pass reindex pipeline + link_index writer
│   ├── file-manager.ts       Single owner of disk writes (fm.writeNote)
│   ├── parsers.ts            Frontmatter, wiki-links, tags, tasks, parseTag
│   ├── slug-resolver.ts      Cross-folder [[wiki-link]] resolution
│   ├── git-autocommit.ts     Background vault history loop
│   ├── cli.ts                Maintenance CLI (trash prune, vacuum, FTS rebuild)
│   ├── config.ts             env → ScryptConfig
│   ├── auth.ts               Bearer token gate
│   ├── router.ts             Route matcher
│   └── websocket.ts          Live-reload broadcaster
├── client/                   React + Vite + Tailwind
│   ├── views/                Routed views (GraphView, NotesList, Editor, etc.)
│   ├── components/           Sidebar, FolderTree, NewNoteModal, RelatedPanel, etc.
│   ├── store.ts              Zustand
│   └── api.ts                Fetch wrapper for the REST API
└── shared/
    ├── types.ts              Types used on both sides (Note, NoteMeta, Tag, etc.)
    └── graph-types.ts        GraphNode/Edge/Response for /api/graph
```

## Architecture + deep docs

The `docs/` directory (gitignored — lives on your disk only) has the deep architecture notes:

- **`docs/BUILD_AND_RUN.md`** — every run mode, env var walkthrough, troubleshooting, maintenance
- **`docs/ARCHITECTURE.md`** — data flow, indexer pipeline, invariants, graph builder, why things are the way they are
- **`docs/API.md`** — every endpoint with auth, params, request/response shapes, status codes, error forms

## Contributing

1. Fork, create a feature branch
2. Write tests first — TDD is the house style, check existing tests for the pattern
3. `bun run test` must pass, `bunx tsc --noEmit` must be clean
4. Open a PR against `main`

## Deploying to Oracle Cloud (ARM Always Free)

Scrypt is designed to run on an Oracle Cloud Ampere A1 Always-Free VM (aarch64, 1 GB RAM minimum, 6 GB recommended). Runs in Docker or directly via systemd — `docs/BUILD_AND_RUN.md` has the full walkthrough.

### Short version

```bash
# On the VM, after SSH
sudo apt-get update && sudo apt-get install -y docker.io docker-compose-v2 git
sudo usermod -aG docker $USER
# Log out / back in

git clone https://github.com/psianion/scrypt.git
cd scrypt
cp .env.example .env
# Edit .env — set SCRYPT_AUTH_TOKEN, SCRYPT_VAULT_DIR=/home/ubuntu/vault
mkdir -p /home/ubuntu/vault
docker compose up -d --build
```

Install Tailscale, join your tailnet, and hit `http://<tailnet-ip>:3777` from your laptop or phone.

### Nightly maintenance cron

Prune trash, vacuum the DB, and rebuild FTS once a day:

```
0 3 * * * docker exec scrypt bun /app/src/server/cli.ts maintenance
```

## License

MIT
