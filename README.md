# Scrypt

> A personal second brain for the AI era. Markdown on disk, SQLite-indexed, with a browser UI and a REST API that humans and LLMs both talk to.

Scrypt is the memory layer for how I work. Every project, research thread, interest, and half-baked idea lives here as a `.md` file, and Claude reads and writes into the same vault I do. The result is a knowledge base that keeps its own context across sessions instead of starting from scratch every time I open a new chat.

![Editor with backlinks](assets/screenshots/editor.png)

## What it's for

- **A single place to hold the context of every project.** Specs, plans, research notes, decisions, loose ideas — all linked together as markdown. The graph view makes the shape of what you're building visible.
- **A memory Claude (or any LLM) can read and write.** The REST API gives an agent structured access to the whole vault: pull open threads, fetch linked context, search across everything, drop a research run back. Your notes stop being a dead archive and become live context.
- **A way to connect projects and ideas that would otherwise live in separate silos.** `[[wiki-links]]` and tags let you pull a thread from one corner of your life into another — a book you read into an app you're building, a 3D printing experiment into an art project.
- **A shared workspace for parallel Claude sessions.** I run multiple Claude tmux windows continuously — one researching, one writing, one reviewing — all pointed at the same vault. Cron kicks off scheduled sessions while I'm asleep so the API quota I'm paying for is always doing something useful. The graph and backlinks mean those independent sessions still weave into one coherent knowledge base instead of fragmenting into silos.
- **Scriptable end to end.** Every feature is available over HTTP. Cron jobs, shell scripts, Claude agents, and custom tools all drive the same API.

## How I run it

It's just a Bun process reading a folder of markdown, so it runs anywhere Bun runs. My setup:

- **Oracle Cloud Always Free ARM VM** — one tiny Ampere A1 instance hosting the vault
- **Tailscale** — the only way in; never exposed to the public internet
- **Termux + Termius on my phone** — SSH into tmux from anywhere to trigger runs, tail logs, or open the UI
- **Several Claude tmux windows running in parallel** — one per active workstream, each reading and writing back to the same vault
- **Cron** — overnight and off-hours schedules kick off research sessions, summaries, and retries so the API limits I'm paying for aren't sitting idle
- **Telegram alerts** — simple notifications when a run finishes or something needs attention

You can do the exact same thing on a Raspberry Pi, a spare laptop, or just localhost. The server has no idea where it's running — it just indexes the folder you point it at.

## What you get

| | |
|---|---|
| **Editor** | CodeMirror 6 with markdown syntax, auto-save, `Cmd+S`, dark theme |
| **Links** | `[[wiki-links]]`, automatic backlinks panel, clickable navigation |
| **Graph** | D3 force-directed graph of the whole vault — zoom, pan, click to open |
| **Search** | SQLite FTS5 full-text search with BM25 ranking and live results |
| **Kanban** | Every `- [ ]` task across your vault on a drag-and-drop board |
| **Journal** | Daily notes with a date picker and template substitution |
| **Data** | Drop a `.csv` in `data/`, get a sortable table preview |
| **Tags** | `#tag` extraction with a hierarchical browser (`#project/scrypt`) |
| **Templates** | Per-note templates with `{date}`, `{title}`, `{now}` |
| **Command palette** | `Cmd+K` fuzzy search across every note |
| **REST API** | Full read/write surface — notes, search, graph, tasks, data, more |
| **Live reload** | External edits (git pull, another editor) appear in the UI instantly |

![Graph view](assets/screenshots/graph.png)

## Built with

- **[Bun](https://bun.sh)** — runtime, bundler, test runner, SQLite driver, HTTP server
- **React 19 + Vite + Tailwind** — client
- **CodeMirror 6** — editor
- **D3** — graph rendering
- **SQLite FTS5** — index and search
- **Zustand** — client state
- **`@dnd-kit`** — kanban drag-and-drop

Zero runtime dependencies beyond Bun. No Node, no npm, no database server to install.

## Who it's for

- **You, if you like markdown** and want something more capable than "a folder of files" without locking your data in a cloud app.
- **Developers** who want to drive a knowledge base from scripts — dump research notes from a curl call, query the graph from a cron job, build a custom view on top of the API.
- **Anyone building with Claude or another LLM** who needs a scriptable place to write and read notes. Every endpoint takes JSON in, returns JSON out, and the vault is plain markdown you can still edit by hand.

## Quick start

You need [Bun](https://bun.sh) 1.x and a folder of markdown files.

```bash
git clone https://github.com/psianion/scrypt.git
cd scrypt
bun install
bun run build
```

Then point it at any vault:

```bash
cd ~/my-notes
bun /path/to/scrypt/src/server/index.ts
```

Open <http://localhost:3777>.

Drop a file in, hit save, and it's in the graph:

```markdown
---
title: Welcome
tags: [intro]
---

# Welcome

Link to [[another note]] and it shows up in the backlinks panel
and graph view.

- [ ] Check the kanban view for this task
- [x] Read this README
```

## Using it in the browser

| Route | Shows |
|---|---|
| `/journal` | Today's daily note (auto-created from template) |
| `/notes` | All notes with sort + tag filter |
| `/graph` | Interactive force-directed graph |
| `/tasks` | Kanban board of every inline task |
| `/data` | CSV file browser with sortable preview |
| `/tags` | Hierarchical tag tree |
| `/search` | Live full-text search |
| `/settings` | Editor preferences |
| `/note/*path` | Edit any note |

Shortcuts: `Cmd+K` opens the command palette, `Cmd+S` saves the current note.

![Kanban board](assets/screenshots/kanban.png)

## Using it from the API

The browser UI talks to the same REST API your scripts will. JSON in, JSON out.

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

### Search

```bash
curl "http://localhost:3777/api/search?q=scrypt"
```

### List open tasks

```bash
curl "http://localhost:3777/api/tasks?done=false"
```

### Get the graph as JSON

```bash
curl http://localhost:3777/api/graph | jq .
```

### Full endpoint map

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/notes` | List notes with `?tag`, `?folder`, `?sort` filters |
| `GET` | `/api/notes/*path` | Read a note with frontmatter + backlinks |
| `POST` | `/api/notes` | Create a note |
| `PUT` | `/api/notes/*path` | Update a note |
| `DELETE` | `/api/notes/*path` | Soft-delete to `.scrypt/trash/` |
| `GET` | `/api/search?q=` | Full-text search |
| `GET` | `/api/search/tags?q=` | Tag completion |
| `GET` | `/api/graph` | Whole-vault graph |
| `GET` | `/api/graph/*path?depth=N` | Local subgraph |
| `GET` | `/api/backlinks/*path` | Linking notes with context |
| `GET` | `/api/journal/today` | Today's note |
| `GET` | `/api/journal/:date` | Entry for a specific date |
| `GET` | `/api/templates` | List templates |
| `POST` | `/api/templates/apply` | Create a note from a template |
| `GET` | `/api/tasks` | All inline tasks (`?board`, `?done`, `?tag`) |
| `PUT` | `/api/tasks/:id` | Update task state |
| `GET` | `/api/data` | List CSV/XLSX files |
| `GET` | `/api/data/*file` | Parsed CSV as JSON |
| `GET` | `/api/data/*file/schema` | Headers, types, row count |
| `POST` | `/api/files/upload` | Upload an asset |
| `GET` | `/api/files/*path` | Serve an uploaded asset |
| `GET` | `/api/plugins` | List installed plugins |
| `GET` | `/api/skills` | List skill definitions |

![Full-text search](assets/screenshots/search.png)

## Vault layout

Any `.md` file anywhere under the vault is indexed. Scrypt is opinionated about where things live but doesn't enforce it.

```
my-notes/
├── notes/            Your main notes
│   ├── inbox/        Quick captures, to triage later
│   ├── projects/
│   └── welcome.md
├── journal/          One file per day (YYYY-MM-DD.md)
├── data/             CSV files browsable in the Data view
├── templates/        Markdown templates with {date}, {title}, {now}
├── assets/           Uploaded images and attachments
└── .scrypt/          Scrypt's own state (ignored by git)
    ├── scrypt.db     SQLite index — regenerated if deleted
    └── trash/        Soft-deleted notes
```

![CSV preview in Data view](assets/screenshots/data-csv.png)

## Development

```bash
bun install
bun run dev           # server with hot reload on :3777
bun run dev:client    # Vite on :5173 for the React side
bun run test          # full test suite (server + client)
bun run build         # production client bundle
```

```
src/
├── server/           Bun server — API, indexer, watcher, WebSocket
│   ├── api/          REST route handlers
│   ├── db.ts         SQLite schema and FTS5 setup
│   ├── indexer.ts    Two-pass reindex pipeline
│   ├── file-manager.ts
│   ├── parsers.ts    Frontmatter, wiki-links, tags, tasks
│   ├── router.ts
│   └── websocket.ts  Live-reload broadcaster
├── client/           React + Vite + Tailwind
│   ├── views/        Routed views
│   ├── components/
│   ├── store.ts      Zustand
│   └── api.ts        Fetch wrapper for the REST API
└── shared/
    └── types.ts      Types used on both sides
```

## Contributing

1. Fork, create a feature branch
2. Write tests first — TDD is the house style, check existing tests for the pattern
3. `bun run test` must pass
4. Open a PR against `main`

## Deploying to Oracle Cloud (ARM Always Free)

Scrypt is designed to run on an Oracle Cloud Ampere A1 Always-Free VM (aarch64, 1GB RAM). It can run in Docker or directly via systemd.

### Prerequisites

- An Ampere A1 VM (Ubuntu 22.04 or similar)
- A Tailscale-connected network (recommended — keeps the API off the public internet)
- A secret token you'll generate yourself and pass as `SCRYPT_AUTH_TOKEN`

### Option A: Docker

```bash
# On the VM
sudo apt-get update && sudo apt-get install -y docker.io docker-compose-v2 git
sudo usermod -aG docker $USER
# Log out / back in for group change

git clone https://github.com/your-org/scrypt.git
cd scrypt
cp .env.example .env
# Edit .env — set SCRYPT_AUTH_TOKEN to a strong random value
mkdir vault
docker compose up -d

# Verify
curl -s -H "Authorization: Bearer $(grep SCRYPT_AUTH_TOKEN .env | cut -d= -f2)" \
  http://localhost:3777/api/daily_context
```

### Option B: systemd (lower RAM ceiling)

```bash
# Install Bun
curl -fsSL https://bun.sh/install | bash

# Clone and install dependencies
sudo useradd -m -s /bin/bash scrypt
sudo mkdir -p /opt/scrypt /etc/scrypt
sudo chown scrypt:scrypt /opt/scrypt
sudo -u scrypt git clone https://github.com/your-org/scrypt.git /opt/scrypt
sudo -u scrypt bash -lc "cd /opt/scrypt && bun install && bun run build"

# Configure
sudo tee /etc/scrypt/scrypt.env > /dev/null <<EOF
SCRYPT_AUTH_TOKEN=change-me
SCRYPT_VAULT_PATH=/home/scrypt/vault
NODE_ENV=production
EOF
sudo mkdir -p /home/scrypt/vault
sudo chown -R scrypt:scrypt /home/scrypt/vault

# Install and start
sudo cp /opt/scrypt/systemd/scrypt.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now scrypt
sudo systemctl status scrypt
```

### Nightly maintenance cron

Prune trash, vacuum the DB, and rebuild FTS once a day:

```
0 3 * * * cd /home/scrypt/vault && /home/scrypt/.bun/bin/bun /opt/scrypt/src/server/cli.ts maintenance
```

### Smoke test from the orchestrator

```bash
TOKEN=your-token
HOST=http://scrypt.tailnet:3777

curl -s -H "Authorization: Bearer $TOKEN" "$HOST/api/daily_context" | jq .
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"kind":"thought","title":"Smoke","content":"hello"}' \
  "$HOST/api/ingest"
```

## License

MIT
