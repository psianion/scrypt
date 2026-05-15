# Scrypt

> A personal second brain for the AI era. Markdown on disk, SQLite-indexed, with a browser UI, a REST API, and an MCP server that humans and LLMs both talk to.

Every project, research thread, and half-baked idea lives as a `.md` file under `projects/<project>/<doc_type>/<slug>.md`. Claude reads and writes into the same vault you do, so your knowledge base keeps its own context across sessions instead of starting from scratch every chat.

Each ingested note carries a `ingest:` frontmatter block (source hash, tokens, cost, model) and an optional `thread:` that groups a workstream into research → spec → plan chains via typed lineage edges (`derives-from`, `implements`, `supersedes`).

![Editor with backlinks](assets/screenshots/editor.png)

## Features

| | |
|---|---|
| **Editor** | CodeMirror 6 markdown, auto-save, line wrap, backlinks panel |
| **Graph** | Pixi WebGL canvas with tiered lineage edges (`connected` / `mentions` / `semantic`) over typed `add_edge` + embedding similarity |
| **Search** | SQLite FTS5 keyword search + **semantic search** over local `bge-small-en-v1.5` embeddings, hybrid RRF on `/api/graph/search` |
| **MCP server** | 19 tools over stdio + `POST /mcp` streamable-http. JSON-RPC 2.0, bearer auth, idempotent `client_tag`s |
| **Design system** | Token-driven UI (every color/space/radius routed through `theme/tokens.css`), light + dark with `prefers-color-scheme` auto, `⌘⇧L` to toggle, `/design-system` inspector for every primitive × variant × state |
| **Live overlay** | Journal view ActivityStrip + CodeMirror `embed-pulse` + graph node pulse, all driven by a `vault:embedding` WebSocket channel |
| **REST API** | Full read/write surface for notes, search, graph, tasks, threads, research runs, daily context |
| **Kanban / Data / Tags** | Every `- [ ]` across the vault on one board; CSV/XLSX preview; hierarchical tag browser |
| **Git autocommit** | Opt-in background loop snapshots the vault every 15 min |

![Graph view](assets/screenshots/graph.png)

## Quick start (Docker Desktop)

```bash
git clone https://github.com/psianion/scrypt.git
cd scrypt
cp .env.example .env
# set SCRYPT_AUTH_TOKEN + SCRYPT_VAULT_DIR=/Users/you/scrypt-vault
mkdir -p /Users/you/scrypt-vault
docker compose up -d --build
open http://localhost:3777
```

Or run it directly: `SCRYPT_VAULT_PATH=~/scrypt-vault bun run src/server/index.ts`.

## MCP — second brain for Claude

Register the Scrypt MCP server in Claude Code:

```bash
./scripts/install-scrypt-mcp.sh
```

That installs the 19 tools over HTTP:

- **Reads (7)** — `get_note`, `search_notes`, `semantic_search`, `find_similar`, `walk_graph`, `cluster_graph`, `get_report`
- **Content writes (5)** — `create_note`, `update_note_metadata`, `add_section_summary`, `add_edge`, `remove_edge`
- **Tasks (5)** — `create_task`, `get_task`, `list_tasks`, `update_task`, `delete_task`
- **Maintenance (2)** — `batch_ingest`, `rescan_similarity`

Every `create_note` runs the full chunking + embedding pipeline server-side and broadcasts live progress to the UI overlay.

For stdio instead of HTTP: `bun run scrypt-mcp`.

## Environment variables

Core:

| Var | Default | Note |
|---|---|---|
| `SCRYPT_AUTH_TOKEN` | — | Required in production for non-localhost callers |
| `SCRYPT_VAULT_PATH` | `cwd` | Where your notes live (inside the container: `/vault`) |
| `SCRYPT_VAULT_DIR` | `./vault` | Host path mounted as `/vault` by docker compose |
| `SCRYPT_PORT` | `3777` | |
| `SCRYPT_GIT_AUTOCOMMIT` | `0` | `1` enables the 15-min vault snapshot loop |

Wave 8 embeddings (all optional, sensible defaults):

| Var | Default |
|---|---|
| `SCRYPT_EMBED_MODEL` | `Xenova/bge-small-en-v1.5` |
| `SCRYPT_EMBED_CACHE_DIR` | `/data/embed-cache` (named volume in compose) |
| `SCRYPT_EMBED_MAX_TOKENS` / `SCRYPT_EMBED_OVERLAP` / `SCRYPT_EMBED_BATCH` | `450` / `50` / `8` |
| `SCRYPT_EMBED_PREWARM` | `1` (compose) — load the model at boot |
| `SCRYPT_EMBED_DISABLE` | `0` — set `1` to skip embeddings entirely |

Full catalog and three-layer flow (`.env → docker-compose → loadConfig`) in `docs/BUILD_AND_RUN.md`.

## Fresh start (test vault)

After any change to the ingest schema, the test vault is wiped and reingested — no migration tooling is maintained.

1. `docker compose down`
2. `rm -rf "$SCRYPT_VAULT_DIR"/* "$SCRYPT_VAULT_DIR"/.scrypt` (e.g. `/Users/admin/scrypt-dnd-test`)
3. `docker compose up -d`
4. For each project root on disk: `/scrypt-ingest <source-root> --project <name>`
5. Verify via `mcp__scrypt__get_report({})` that `projects[]` and `threads[]` look correct.

The ingest skill is idempotent: re-running it on the same source files is safe (hash-matched skips). If source content changed, the slug bumps to `-v2` and a `supersedes` edge is emitted from the new note to the prior one.

Loose captures that don't fit an existing project route to the reserved `_inbox` project; promote them later via the graph UI's "Move to project" action.

## Docs

`docs/` is gitignored (your local-only copy):

- `docs/BUILD_AND_RUN.md` — every run mode, env walkthrough, maintenance, troubleshooting
- `docs/ARCHITECTURE.md` — data model, indexer pipeline, Wave 8 MCP + embeddings chapter, load-bearing invariants
- `docs/API.md` — every REST endpoint, every MCP tool, auth, error codes

## License

MIT
