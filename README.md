# Scrypt

> A local-first, markdown-native second brain with a graph view, full-text search, a kanban board, CSV embeds, and a REST API that Claude (or any script) can drive.

Your notes stay as plain `.md` files on disk. Everything else — the index, the graph, the search, the kanban, the UI — is built on top. No lock-in, no cloud, no proprietary format. Pointed at your existing Obsidian vault, it just works.

![Editor with backlinks](assets/screenshots/editor.png)

---

## Why

Most knowledge tools fall into one of two camps:

- **Cloud notebooks** (Notion, Evernote, Roam): pretty, but your data is trapped behind a proprietary API and a subscription.
- **Plain-text editors** (Obsidian, Logseq, VS Code): your data is yours, but the second you want something programmable — a Claude workflow, a script, a cron job — you're on your own.

Scrypt is the middle path: **plain markdown files on disk, with a server that indexes them and a REST API you can automate against.** Use the browser UI when you want to read and write by hand; call the API when you want a machine to write into the same vault.

## Features

| | |
|---|---|
| **Editor** | CodeMirror 6, markdown syntax highlighting, auto-save, `Cmd+S`, dark theme |
| **Links** | `[[wiki-links]]`, automatic backlinks, hover preview |
| **Graph** | D3 force-directed graph of the whole vault, zoom, pan, click to navigate |
| **Search** | SQLite FTS5, full-text with BM25 ranking, prefix matching, debounced live search |
| **Kanban** | Every `- [ ]` task in your vault on a drag-and-drop board |
| **Journal** | Daily notes with a calendar picker and template substitution |
| **Data** | Drop a `.csv` in `data/`, get a sortable table you can embed in notes |
| **Tags** | `#tag` extraction with hierarchical browser (`#project/scrypt`) |
| **Templates** | Per-note templates with `{date}`, `{title}`, `{now}` variables |
| **Command palette** | `Cmd+K` fuzzy search across all notes |
| **REST API** | Notes, search, graph, backlinks, tasks, data, journal, templates, files, plugins, skills |
| **WebSocket live-reload** | External edits (git pull, mobile editor) appear in the UI instantly |

![Graph view](assets/screenshots/graph.png)

## Requirements

- **[Bun](https://bun.sh) 1.x** — the only runtime dependency
- A directory you want to use as your vault (any folder of `.md` files)

That's it. No Node, no npm, no Docker required for local use.

## Quick start

### 1. Clone and install

```bash
git clone https://github.com/psianion/scrypt.git
cd scrypt
bun install
bun run build        # builds the React client once
```

### 2. Point it at a vault

```bash
mkdir -p ~/my-vault/notes ~/my-vault/journal
cd ~/my-vault
bun /path/to/scrypt/src/server/index.ts
```

Open <http://localhost:3777> in your browser.

### 3. Write a note

Create `~/my-vault/notes/welcome.md`:

```markdown
---
title: Welcome
tags: [intro]
---

# Welcome

Scrypt indexes every `.md` file in this folder. Link to [[another note]]
and it shows up in the backlinks panel + graph view.

- [ ] Try the kanban view with this task
- [x] Read this README
```

The file watcher picks it up instantly — no refresh needed.

## Using it from the browser

| Route | Shows |
|---|---|
| `/` → `/journal` | Today's journal entry |
| `/notes` | All notes with sort + tag filter |
| `/graph` | Interactive force-directed graph |
| `/tasks` | Kanban board pulling from inline `- [ ]` tasks |
| `/data` | CSV file browser with sortable preview |
| `/tags` | Hierarchical tag tree |
| `/search` | Full-text search with live results |
| `/settings` | Editor preferences, plugin toggles |
| `/note/:path` | Edit any note |

Shortcuts: `Cmd+K` opens the command palette, `Cmd+S` saves the current note.

![Kanban board](assets/screenshots/kanban.png)

## Using it from the CLI / API

Scrypt's REST API is the same contract the browser UI talks to. Every endpoint returns JSON and accepts `application/json` bodies.

### Create a note

```bash
curl -X POST http://localhost:3777/api/notes \
  -H "Content-Type: application/json" \
  -d '{
    "path": "notes/inbox/from-cli.md",
    "content": "# Hello from curl",
    "tags": ["automation"]
  }'
```

### Search the vault

```bash
curl "http://localhost:3777/api/search?q=scrypt"
```

### List tasks, filter by board

```bash
curl "http://localhost:3777/api/tasks?board=backlog&done=false"
```

### Get the graph as JSON

```bash
curl http://localhost:3777/api/graph | jq .
```

### Full API surface

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/notes` | List notes with filters |
| `GET` | `/api/notes/*path` | Read a note with frontmatter + backlinks |
| `POST` | `/api/notes` | Create a note |
| `PUT` | `/api/notes/*path` | Update a note |
| `DELETE` | `/api/notes/*path` | Soft-delete to `.scrypt/trash/` |
| `GET` | `/api/search?q=` | FTS5 search |
| `GET` | `/api/search/tags?q=` | Tag completion |
| `GET` | `/api/graph` | Whole-vault graph |
| `GET` | `/api/graph/*path?depth=N` | Local subgraph |
| `GET` | `/api/backlinks/*path` | Backlinks with context |
| `GET` | `/api/journal/today` | Today's note (created from template if missing) |
| `GET` | `/api/journal/:date` | Entry for a specific date |
| `GET` | `/api/templates` | List available templates |
| `POST` | `/api/templates/apply` | Create a note from a template |
| `GET` | `/api/tasks` | All tasks across the vault |
| `PUT` | `/api/tasks/:id` | Update task status/board/priority |
| `GET` | `/api/data` | List CSV/XLSX files in `data/` |
| `GET` | `/api/data/*file` | Parsed CSV as JSON |
| `GET` | `/api/data/*file/schema` | Headers, types, row count |
| `POST` | `/api/files/upload` | Upload an asset |
| `GET` | `/api/files/*path` | Serve an uploaded asset |
| `GET` | `/api/plugins` | List installed plugins |
| `POST` | `/api/plugins/:id/enable` | Toggle a plugin |
| `GET` | `/api/skills` | List skill definitions |
| `POST` | `/api/skills` | Create a skill |
| `PUT` | `/api/skills/:name` | Update a skill |
| `DELETE` | `/api/skills/:name` | Delete a skill |

![Full-text search](assets/screenshots/search.png)

## Vault structure

Scrypt is opinionated about where things live but does not enforce it — any `.md` file anywhere under the vault is indexed.

```
my-vault/
├── notes/              # Your main notes
│   ├── inbox/          # Quick captures, to triage later
│   ├── projects/
│   └── welcome.md
├── journal/            # One file per day (YYYY-MM-DD.md)
│   └── 2026-04-12.md
├── data/               # CSV files visible in the Data explorer
│   └── books.csv
├── templates/          # Markdown templates with {date}, {title}, {now}
│   └── daily.md
├── assets/             # Uploaded images + attachments
├── skills/             # (Phase 2) Claude skill definitions
├── plugins/            # (Phase 2) Custom plugins
└── .scrypt/            # Scrypt's own state (ignored by git)
    ├── scrypt.db       # SQLite index — regenerated if deleted
    └── trash/          # Soft-deleted notes (30-day retention)
```

![Data explorer — CSV preview](assets/screenshots/data-csv.png)

## Development

```bash
# Install deps
bun install

# Run the full dev stack (server + vite client with HMR)
bun run dev              # Bun server on :3777 with --hot reload
bun run dev:client       # Vite on :5173 for the React side

# Run the test suite (141 tests as of v0.1.0)
bun run test             # server + client sequentially
bun run test:server
bun run test:client

# Build the production client bundle
bun run build
```

The codebase is organized as a single Bun monorepo-lite:

```
src/
├── server/              # Bun server — API, indexer, file watcher, WS
│   ├── api/             # REST route handlers
│   ├── db.ts            # SQLite schema + FTS5
│   ├── indexer.ts       # Two-pass reindex pipeline
│   ├── file-manager.ts  # Read / write / watch .md files
│   ├── parsers.ts       # Frontmatter, wiki-links, tags, tasks
│   ├── router.ts        # Minimal request router
│   └── websocket.ts     # Live-reload broadcaster
├── client/              # React + Vite + Tailwind
│   ├── views/           # Routed views (Editor, Graph, Kanban, etc.)
│   ├── components/      # Sidebar, tab bar, command palette
│   ├── store.ts         # Zustand
│   └── api.ts           # Fetch wrapper for the REST API
└── shared/
    └── types.ts         # Types imported by both server and client
```

## Roadmap

### ✅ Shipped — v0.1.0

- Full markdown CRUD, indexer, FTS5 search, graph view, backlinks
- Kanban from inline tasks, journal with templates, tag hierarchy
- CSV data explorer, command palette, settings UI
- 141 tests, all passing
- Tested visually end-to-end via Playwright

### 🚧 In progress — Research Node extension

Scrypt is being extended into the knowledge layer of an autonomous [Claude research orchestrator](docs/superpowers/specs/2026-04-12-scrypt-research-node-design.md) running on a cloud VPS. This adds:

- **Threads** — `notes/threads/*.md` with `status: open | in-progress | resolved | blocked | paused | archived`
- **Research runs** — Claude-written findings with full traceability back to the source thread
- **Memories** — long-lived interest profiles that seed every research session
- **Smart ingest router** — `POST /api/ingest { kind, title, content }` routes content to the right folder by type
- **Bearer token auth** with a dev-localhost bypass
- **Activity log** — every write is tracked (`create`, `update`, `delete`, `append`, `snapshot`)
- **Git-backed version history** — opt-in autocommit every N minutes for free time-travel
- **Daily context bundle** — one endpoint that returns today's journal, recent notes, open threads, and active memories in a single round-trip
- **Docker + systemd** packaging for Oracle ARM Always Free

See the full [design spec](docs/superpowers/specs/2026-04-12-scrypt-research-node-design.md) and [31-task implementation plan](docs/superpowers/plans/2026-04-12-scrypt-research-node.md).

### 💡 Nice-to-haves (post-v0.2)

- Live markdown preview in the editor
- Slash commands and image paste-to-upload
- Multi-user auth
- Mobile-optimized read view

## Contributing

This started as a personal tool, but it's intentionally designed to be useful to anyone who wants a local-first, programmable markdown vault. Contributions welcome:

1. Fork, create a feature branch
2. Write tests first (TDD is the house style — see existing tests for the pattern)
3. `bun run test` must pass
4. Open a PR against `main`

If you're planning a larger change, open an issue first or drop a spec in `docs/superpowers/specs/` so we can align before code.

## License

MIT — do whatever you want with it, no warranty.

---

Built with [Bun](https://bun.sh), [React](https://react.dev), [CodeMirror 6](https://codemirror.net), [D3](https://d3js.org), [SQLite FTS5](https://www.sqlite.org/fts5.html), and [Tailwind](https://tailwindcss.com).
