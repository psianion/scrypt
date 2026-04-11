# Scrypt — Design Spec

> Local-first, web-based second brain built on Bun + React + SQLite.
> Markdown files as source of truth, SQLite for indexing, dual extension model (JS plugins + Claude skills).

---

## Architecture

```
┌─────────────────────────────────────────────────┐
│              BROWSER (React SPA)                │
│                                                 │
│  CodeMirror 6  │  Graph (D3)  │  Kanban (DnD)  │
│  Command Palette (cmdk)  │  Data Explorer       │
│                                                 │
│  State: Zustand    Routing: react-router        │
│                    Styling: Tailwind CSS        │
│                                                 │
│              fetch() + WebSocket                │
└────────────────────┬────────────────────────────┘
                     │ HTTP :3777
┌────────────────────┼────────────────────────────┐
│           BUN SERVER (single process)           │
│                    │                            │
│  ┌─────────────────┴──────────────────────┐     │
│  │           REST API Router              │     │
│  │  /api/notes  /api/search  /api/graph   │     │
│  │  /api/tasks  /api/journal /api/data    │     │
│  │  /api/templates /api/plugins /api/skills│    │
│  └────┬────────────┬──────────────┬───────┘     │
│       │            │              │             │
│  FileManager   IndexManager   PluginLoader     │
│  (read/write/  (bun:sqlite    (ESM + markdown  │
│   watch .md)    FTS5 index)    skills)          │
│       │            │                            │
│  FSWatch → reindex → WebSocket broadcast        │
└───────┼────────────┼────────────────────────────┘
        ▼            ▼
  ~/Desktop/Files/   .scrypt/scrypt.db
  scrypt/            (SQLite index)
  (markdown files)
```

### Tech Stack

| Layer     | Choice                                      |
|-----------|---------------------------------------------|
| Runtime   | Bun                                         |
| Server    | Bun.serve() — HTTP + WebSocket + static     |
| Database  | bun:sqlite — FTS5, backlinks, tags, graph   |
| Frontend  | React 19 + Zustand + react-router           |
| Editor    | CodeMirror 6 + custom extensions            |
| Graph     | D3.js force-directed                        |
| Kanban    | @dnd-kit                                    |
| Cmd Palette | cmdk                                      |
| Styling   | Tailwind CSS (dark monochrome)              |
| Build     | Vite (dev) / Bun bundler (prod)             |
| Data      | Markdown + CSV/Excel on disk                |

---

## Data Model

### Folder Structure

```
scrypt/
├── notes/              # User notes (nested folders OK)
│   ├── inbox/
│   ├── projects/
│   └── references/
├── journal/            # Daily notes (auto-created)
├── tasks/              # Kanban task files
├── templates/          # Reusable note templates
├── skills/             # Claude-readable markdown extensions
├── plugins/            # JS plugin modules (ESM)
├── data/               # CSV/Excel data files
├── assets/             # Images, PDFs, attachments
└── .scrypt/            # App metadata (gitignored)
    ├── scrypt.db       # SQLite index
    ├── trash/          # Soft-deleted files (30-day purge)
    └── config.json     # User settings
```

### Note Format

```markdown
---
title: Example Note
tags: [project, active]
created: 2026-04-11T10:30:00Z
modified: 2026-04-11T14:22:00Z
aliases: [example, demo-note]
---

# Example Note

A [[wiki-link]] to another note. A #tag inline.

- [ ] A task item
- [x] A completed task

```csv:data/reading-log.csv
```
```

### SQLite Schema

```sql
-- Source of truth is on disk; these tables are derived indexes
CREATE TABLE notes (
  id INTEGER PRIMARY KEY,
  path TEXT UNIQUE NOT NULL,
  title TEXT,
  content_hash TEXT,
  created TEXT,
  modified TEXT
);

CREATE VIRTUAL TABLE notes_fts USING fts5(
  title, content, path,
  content='notes', content_rowid='id'
);

CREATE TABLE backlinks (
  source_id INTEGER REFERENCES notes(id),
  target_id INTEGER REFERENCES notes(id),
  context TEXT,
  PRIMARY KEY (source_id, target_id)
);

CREATE TABLE tags (
  note_id INTEGER REFERENCES notes(id),
  tag TEXT NOT NULL,
  PRIMARY KEY (note_id, tag)
);

CREATE TABLE graph_edges (
  source_id INTEGER REFERENCES notes(id),
  target_id INTEGER REFERENCES notes(id),
  type TEXT CHECK(type IN ('link', 'tag', 'embed')),
  PRIMARY KEY (source_id, target_id, type)
);

CREATE TABLE tasks (
  id INTEGER PRIMARY KEY,
  note_id INTEGER REFERENCES notes(id),
  text TEXT NOT NULL,
  done INTEGER DEFAULT 0,
  due_date TEXT,
  priority INTEGER DEFAULT 0,
  board TEXT DEFAULT 'backlog'
);

CREATE TABLE aliases (
  note_id INTEGER REFERENCES notes(id),
  alias TEXT NOT NULL,
  PRIMARY KEY (note_id, alias)
);

CREATE TABLE csv_cache (
  file_path TEXT PRIMARY KEY,
  headers TEXT,
  row_count INTEGER,
  last_parsed TEXT
);

CREATE TABLE metadata (
  key TEXT PRIMARY KEY,
  value TEXT
);
```

---

## REST API

```
NOTES
  GET    /api/notes                  List notes (paginated, filterable)
  GET    /api/notes/:path            Get note content + metadata
  POST   /api/notes                  Create note {path, content, tags}
  PUT    /api/notes/:path            Update note content/frontmatter
  DELETE /api/notes/:path            Soft delete → .scrypt/trash/

SEARCH
  GET    /api/search?q=...           Full-text search (FTS5)
  GET    /api/search/tags?q=...      Search by tags

GRAPH
  GET    /api/graph                  All nodes + edges
  GET    /api/graph/:path            Local graph (2-hop)

BACKLINKS
  GET    /api/backlinks/:path        Notes linking to this note

TASKS
  GET    /api/tasks                  All tasks across notes
  GET    /api/tasks?board=...        Filter by kanban board
  PUT    /api/tasks/:id              Update task state

JOURNAL
  GET    /api/journal/today          Get or create today's note
  GET    /api/journal/:date          Get specific date

DATA
  GET    /api/data/:file             Parse CSV/Excel → JSON
  GET    /api/data/:file/schema      Column names, types, row count

FILES
  POST   /api/files/upload           Upload asset
  GET    /api/files/:path            Serve asset

TEMPLATES
  GET    /api/templates              List templates
  POST   /api/templates/apply        Create note from template

PLUGINS
  GET    /api/plugins                List plugins
  POST   /api/plugins/:id/enable     Enable/disable

SKILLS
  GET    /api/skills                 List skill files
  GET    /api/skills/:name           Read skill definition
  POST   /api/skills/:name/run      Execute skill
```

### Server Design Decisions

- **Single port (:3777)** — API, WebSocket, and SPA static files. No CORS.
- **WebSocket live reload** — file watcher triggers reindex → WS broadcast. No polling.
- **Soft delete** — DELETE moves to `.scrypt/trash/` with 30-day auto-purge.
- **Dual Claude integration** — Claude can hit REST API or edit files directly; file watcher picks up both.
- **CSV caching** — parsed once, cached in SQLite, invalidated on file change.

---

## UI Design

### Principles

- Monochrome palette — grays only, no accent colors
- Text-only nav — no icons, just labels
- Quiet typography — system font, medium weights
- Invisible chrome — sidebar and panels recede, editor content is hero
- Dashed underlines for wiki-links
- Information-dense — tight spacing, more visible content

### Layout

```
┌──────────┬─────────────────────────────────┬──────────┐
│          │  Tab Bar (open files)           │          │
│ Sidebar  ├─────────────────────────────────┤ Backlinks│
│          │                                 │ Panel    │
│ - Notes  │  CodeMirror 6 Editor            │          │
│ - Journal│  (markdown live preview)        │ - refs   │
│ - Tasks  │                                 │ - TOC    │
│ - Graph  │  [[wiki-links]] rendered        │          │
│ - Data   │  #tags highlighted             │          │
│          │  CSV embeds as tables           │          │
│ Folders  │                                 │          │
│ Tags     │                                 │          │
│          │                                 │          │
│ Settings │  Status Bar                     │          │
└──────────┴─────────────────────────────────┴──────────┘
```

---

## Plugin System

### JS Plugins

Each plugin lives in `plugins/<name>/` with:
- `manifest.json` — id, name, version, hooks, commands
- `index.js` — ESM module exporting lifecycle hooks + commands

**Lifecycle hooks:** onLoad, onUnload, onNoteOpen, onNoteChange, onNoteSave, onNoteDelete, onSearch

**API surface:**
- `note` — content, frontmatter, path, backlinks
- `ui` — statusBar, toast, sidebar.addPanel, command.register
- `api` — REST client + read-only SQLite queries
- `fs` — read, write, list files in vault

### Claude Skills

Markdown files in `skills/` with:
- YAML frontmatter — name, description, input, output
- Body — instructions + output template for Claude to follow

Skills are triggered via `POST /api/skills/:name/run` or by Claude reading the file directly.

---

## Phases (TDD)

### Phase 1 — Core Second Brain

Everything needed for daily use as a knowledge management tool.

#### 1.1 Bun Server + File System Manager

The foundation. Serves the SPA, manages markdown files on disk.

**Features:**
- Bun.serve() on :3777 serving static files + API routes
- FileManager: readNote, writeNote, deleteNote (soft), listNotes, watchFiles
- YAML frontmatter parsing (title, tags, created, modified, aliases)
- File watcher (FSWatch) detecting create/modify/delete events

**Tests:**
```
server.test.ts
  ✓ starts on configured port and serves static files
  ✓ returns 404 for unknown API routes
  ✓ serves index.html for SPA fallback routes

file-manager.test.ts
  ✓ readNote returns content + parsed frontmatter for a .md file
  ✓ readNote returns null for non-existent path
  ✓ writeNote creates file with frontmatter + content
  ✓ writeNote updates modified timestamp in frontmatter
  ✓ writeNote creates parent directories if needed
  ✓ deleteNote moves file to .scrypt/trash/ with timestamp prefix
  ✓ deleteNote returns error for non-existent file
  ✓ listNotes returns all .md files recursively with metadata
  ✓ listNotes respects folder filter parameter
  ✓ watchFiles emits create event when new .md file appears
  ✓ watchFiles emits modify event when .md file content changes
  ✓ watchFiles emits delete event when .md file is removed
  ✓ watchFiles ignores non-.md files and .scrypt/ directory
  ✓ parseFrontmatter extracts YAML block from markdown
  ✓ parseFrontmatter returns empty object for notes without frontmatter
```

#### 1.2 SQLite Indexer

Indexes markdown files into SQLite for search, backlinks, tags, and graph.

**Features:**
- Schema initialization (create tables on first run)
- Full reindex of vault on startup
- Incremental reindex on file change (via watcher)
- Wiki-link parser: extracts `[[targets]]` from markdown content
- Tag parser: extracts `#tags` and frontmatter tags
- Task parser: extracts `- [ ]` and `- [x]` items
- Content hash to skip unchanged files

**Tests:**
```
indexer.test.ts
  ✓ initializes schema on first run (all tables created)
  ✓ reindexNote inserts note record with path, title, content_hash
  ✓ reindexNote updates existing note when content_hash changes
  ✓ reindexNote skips update when content_hash matches
  ✓ reindexNote extracts wiki-links and inserts backlinks
  ✓ reindexNote handles [[link|display text]] syntax
  ✓ reindexNote resolves aliases when creating backlinks
  ✓ reindexNote extracts inline #tags and frontmatter tags
  ✓ reindexNote normalizes hierarchical tags (parent/child)
  ✓ reindexNote creates graph_edges for links, tags, and embeds
  ✓ reindexNote extracts tasks with text, done state, position
  ✓ removeNote cleans up all related records (backlinks, tags, tasks)
  ✓ fullReindex processes all .md files and builds complete index
  ✓ fullReindex removes stale records for deleted files
  ✓ FTS5 search returns ranked results matching query
  ✓ FTS5 search supports prefix matching (e.g., "arch*")
  ✓ getBacklinks returns notes linking to target with context snippet
  ✓ getGraph returns all nodes and edges for force-directed graph
  ✓ getLocalGraph returns nodes within N hops of a given note
  ✓ getTags returns all tags with note counts
  ✓ getTasks returns tasks with source note path and line number
```

#### 1.3 REST API — Notes CRUD

Exposes note operations over HTTP for both the frontend and Claude.

**Tests:**
```
api-notes.test.ts
  ✓ GET /api/notes returns paginated list with title, path, tags, modified
  ✓ GET /api/notes?tag=project filters by tag
  ✓ GET /api/notes?folder=projects filters by folder
  ✓ GET /api/notes?sort=modified sorts by last modified
  ✓ GET /api/notes/:path returns full content + frontmatter + backlinks
  ✓ GET /api/notes/:path returns 404 for missing note
  ✓ POST /api/notes creates file on disk with auto-generated frontmatter
  ✓ POST /api/notes returns 409 if path already exists
  ✓ POST /api/notes triggers reindex via file watcher
  ✓ PUT /api/notes/:path updates content and modified timestamp
  ✓ PUT /api/notes/:path returns 404 for missing note
  ✓ PUT /api/notes/:path triggers reindex
  ✓ DELETE /api/notes/:path soft-deletes to .scrypt/trash/
  ✓ DELETE /api/notes/:path removes from SQLite index
```

#### 1.4 REST API — Search, Graph, Backlinks

Query endpoints powered by SQLite.

**Tests:**
```
api-search.test.ts
  ✓ GET /api/search?q=term returns ranked FTS5 results with snippets
  ✓ GET /api/search?q=term returns empty array for no matches
  ✓ GET /api/search/tags?q=pro returns matching tags with counts
  ✓ GET /api/graph returns {nodes: [...], edges: [...]} for all notes
  ✓ GET /api/graph/:path returns local graph with depth parameter
  ✓ GET /api/backlinks/:path returns linking notes with context
  ✓ GET /api/backlinks/:path returns empty array if no backlinks
```

#### 1.5 REST API — Journal & Templates

Daily notes and template application.

**Tests:**
```
api-journal.test.ts
  ✓ GET /api/journal/today returns today's note if it exists
  ✓ GET /api/journal/today creates note from daily template if missing
  ✓ GET /api/journal/today uses YYYY-MM-DD.md filename
  ✓ GET /api/journal/:date returns note for specific date
  ✓ GET /api/journal/:date returns 404 for dates without notes

api-templates.test.ts
  ✓ GET /api/templates returns list of .md files in templates/
  ✓ POST /api/templates/apply creates note from template with variable substitution
  ✓ POST /api/templates/apply substitutes {title}, {date}, {now}
  ✓ POST /api/templates/apply returns 404 for missing template
```

#### 1.6 WebSocket Live Reload

Pushes file changes to connected browsers.

**Tests:**
```
websocket.test.ts
  ✓ client connects to ws://localhost:3777/ws
  ✓ server broadcasts {type: "noteChanged", path} on file modify
  ✓ server broadcasts {type: "noteCreated", path} on file create
  ✓ server broadcasts {type: "noteDeleted", path} on file delete
  ✓ server broadcasts {type: "reindexed"} after index update
  ✓ multiple clients receive same broadcast
  ✓ server handles client disconnect gracefully
```

#### 1.7 React Shell + Routing

Application shell with sidebar, tabs, and view routing.

**Tests:**
```
app-shell.test.tsx
  ✓ renders sidebar with nav items: Notes, Journal, Tasks, Graph, Data
  ✓ renders folder tree from /api/notes response
  ✓ clicking nav item routes to correct view
  ✓ clicking note in sidebar opens it in editor and adds tab
  ✓ tab bar shows open files, active tab is highlighted
  ✓ closing tab removes it and switches to adjacent tab
  ✓ Cmd+K opens command palette
  ✓ command palette searches notes by title with fuzzy matching
  ✓ command palette shows recent notes at top when empty
  ✓ selecting note from palette opens it in editor
  ✓ sidebar folders are collapsible
  ✓ right-click context menu: new note, new folder, rename, delete
```

#### 1.8 CodeMirror 6 Editor

Markdown editor with live preview and custom syntax.

**Tests:**
```
editor.test.tsx
  ✓ renders markdown content from note
  ✓ saves content on Cmd+S (calls PUT /api/notes/:path)
  ✓ auto-saves after 2 seconds of inactivity
  ✓ renders [[wiki-links]] with dashed underline styling
  ✓ clicking [[wiki-link]] navigates to target note
  ✓ Ctrl+clicking [[wiki-link]] opens in split pane
  ✓ autocompletes [[ with list of note titles
  ✓ autocomplete includes aliases
  ✓ renders #tags with muted styling
  ✓ renders checkboxes for - [ ] and - [x] items
  ✓ clicking checkbox toggles done state and saves
  ✓ renders headings with correct size hierarchy
  ✓ renders code blocks with syntax highlighting
  ✓ renders ```csv:path embeds as inline tables
  ✓ updates content when WebSocket reports external change
  ✓ shows conflict prompt if local and remote both changed
```

#### 1.9 Backlinks Panel

Right sidebar showing notes that reference the current note.

**Tests:**
```
backlinks-panel.test.tsx
  ✓ fetches backlinks from /api/backlinks/:path on note open
  ✓ displays list of linking notes with context snippets
  ✓ clicking backlink navigates to source note
  ✓ shows count in panel header
  ✓ shows "No backlinks" when empty
  ✓ updates when WebSocket reports reindex
  ✓ renders table of contents from current note headings
```

#### 1.10 Graph View

Interactive visualization of note connections.

**Tests:**
```
graph-view.test.tsx
  ✓ fetches graph data from /api/graph
  ✓ renders D3 force-directed graph with nodes and edges
  ✓ node size scales with connection count
  ✓ clicking node navigates to note
  ✓ hovering node highlights connected edges
  ✓ supports zoom and pan
  ✓ filter controls: filter by tag, search by title
  ✓ toggle between full graph and local graph (2-hop from current note)
  ✓ graph updates when WebSocket reports reindex
```

#### 1.11 Daily Journal View

Calendar-based daily note navigation.

**Tests:**
```
journal-view.test.tsx
  ✓ opens today's note on view load (creates if missing)
  ✓ shows calendar picker for date navigation
  ✓ calendar highlights dates that have journal entries
  ✓ clicking date opens that day's note in editor
  ✓ "Today" button returns to current date
```

#### 1.12 Full-Text Search

Search across all notes via command palette and dedicated view.

**Tests:**
```
search.test.tsx
  ✓ Cmd+K opens palette with search input focused
  ✓ typing queries /api/search?q= with debounce
  ✓ results show title, path, and highlighted snippet
  ✓ Enter on result opens note in editor
  ✓ Escape closes palette
  ✓ search view shows results in full page with filters
  ✓ filter by tag narrows results
```

#### 1.13 Split Panes

Side-by-side note editing.

**Tests:**
```
split-panes.test.tsx
  ✓ Ctrl+click on wiki-link opens target in right pane
  ✓ draggable divider resizes panes
  ✓ each pane has independent editor state
  ✓ closing pane returns to single editor
  ✓ both panes respond to WebSocket updates
```

---

### Phase 2 — Tasks, Data & Extensibility

Project management, data integration, and the plugin ecosystem.

#### 2.1 REST API — Tasks

Task aggregation and kanban state management.

**Tests:**
```
api-tasks.test.ts
  ✓ GET /api/tasks returns all tasks across all notes
  ✓ GET /api/tasks includes source note path and line number
  ✓ GET /api/tasks?board=backlog filters by board
  ✓ GET /api/tasks?tag=project filters by source note tag
  ✓ GET /api/tasks?done=false returns only incomplete tasks
  ✓ PUT /api/tasks/:id toggles done state in source markdown file
  ✓ PUT /api/tasks/:id updates board assignment in SQLite
  ✓ PUT /api/tasks/:id with priority updates priority field
  ✓ task changes in markdown file trigger reindex and update task records
```

#### 2.2 Kanban Board View

Drag-and-drop task management extracted from notes.

**Tests:**
```
kanban-view.test.tsx
  ✓ fetches tasks from /api/tasks and groups by board column
  ✓ default columns: Backlog, In Progress, Done
  ✓ renders task cards with text, source note link, tags
  ✓ dragging card between columns calls PUT /api/tasks/:id
  ✓ clicking task card navigates to source note at task line
  ✓ filter bar: filter by tag, search by text
  ✓ "New Task" button creates task in selected note
  ✓ checking off task in kanban updates source markdown
  ✓ board updates when WebSocket reports reindex
```

#### 2.3 REST API — Data (CSV/Excel)

Parse and serve CSV/Excel files as JSON.

**Tests:**
```
api-data.test.ts
  ✓ GET /api/data/:file returns CSV parsed as JSON array of objects
  ✓ GET /api/data/:file handles quoted fields and commas in values
  ✓ GET /api/data/:file returns 404 for missing file
  ✓ GET /api/data/:file rejects paths outside data/ directory
  ✓ GET /api/data/:file/schema returns {headers, types, rowCount}
  ✓ GET /api/data returns list of all CSV/Excel files in data/
  ✓ parsed CSV is cached in SQLite csv_cache table
  ✓ cache is invalidated when file modification time changes
  ✓ Excel (.xlsx) files are parsed using sheet-to-JSON conversion
```

#### 2.4 CSV Embed Renderer

Renders `csv:path` code blocks as interactive tables in the editor.

**Tests:**
```
csv-embed.test.tsx
  ✓ detects ```csv:data/file.csv code blocks in markdown
  ✓ fetches data from /api/data/:file and renders as table
  ✓ table columns match CSV headers
  ✓ table supports click-to-sort by column
  ✓ table shows row count in footer
  ✓ shows error message if CSV file not found
  ✓ updates when underlying CSV file changes (via WebSocket)
```

#### 2.5 Data Explorer View

Browse and inspect CSV/Excel files.

**Tests:**
```
data-explorer.test.tsx
  ✓ lists all files in data/ folder from /api/data
  ✓ clicking file shows table preview with sorting and filtering
  ✓ search bar filters rows by text match
  ✓ column header click sorts ascending/descending
  ✓ shows schema info: column names, types, row count
  ✓ "Embed in note" button copies ```csv:path to clipboard
```

#### 2.6 Tag Hierarchy

Nested tags with browsing.

**Tests:**
```
tag-hierarchy.test.tsx
  ✓ parses parent/child tag format (e.g., project/scrypt)
  ✓ sidebar tag list groups by parent
  ✓ clicking parent tag shows all notes with any child tag
  ✓ clicking child tag filters to that specific tag
  ✓ tag counts reflect actual note associations
  ✓ tag browser view shows all tags as collapsible tree
```

#### 2.7 JS Plugin Loader

Loads ESM plugins from plugins/ directory.

**Tests:**
```
plugin-loader.test.ts
  ✓ scans plugins/ directory for manifest.json files
  ✓ validates manifest schema (id, name, version, entry required)
  ✓ loads plugin ESM module from entry path
  ✓ calls onLoad() lifecycle hook on plugin load
  ✓ calls onUnload() when plugin is disabled
  ✓ calls onNoteOpen() with note data when user opens a note
  ✓ calls onNoteChange() on editor content change
  ✓ calls onNoteSave() after note is saved
  ✓ registers plugin commands in command palette
  ✓ plugin can set status bar items via ui.statusBar.set()
  ✓ plugin can show toast notifications via ui.toast()
  ✓ plugin can add sidebar panel via ui.sidebar.addPanel()
  ✓ plugin can query SQLite read-only via api.db.query()
  ✓ plugin can read/write vault files via fs.read/fs.write
  ✓ plugin crash does not crash the server
  ✓ GET /api/plugins returns list with enabled/disabled state
  ✓ POST /api/plugins/:id/enable toggles plugin state
```

#### 2.8 Plugin API Surface

Injected APIs available to plugins.

**Tests:**
```
plugin-api.test.ts
  ✓ note.content returns current note markdown string
  ✓ note.frontmatter returns parsed YAML as object
  ✓ note.path returns relative file path
  ✓ note.backlinks returns array of linking note paths
  ✓ ui.statusBar.set(id, text) creates/updates status bar item
  ✓ ui.statusBar.remove(id) removes status bar item
  ✓ ui.toast(message) dispatches toast event to frontend
  ✓ ui.command.register({id, name, handler}) adds to palette
  ✓ api.get/post/put/delete call Scrypt REST API
  ✓ api.db.query(sql, params) runs read-only SQLite query
  ✓ api.db.query rejects write operations (INSERT, UPDATE, DELETE)
  ✓ fs.read(path) returns file content as string
  ✓ fs.write(path, content) writes file to vault
  ✓ fs.write rejects paths outside vault directory
  ✓ fs.list(glob) returns matching file paths
```

#### 2.9 Claude Skills System

Markdown-defined extensions for Claude integration.

**Tests:**
```
skills.test.ts
  ✓ GET /api/skills returns list of .md files in skills/ folder
  ✓ GET /api/skills/:name returns parsed skill (frontmatter + body)
  ✓ GET /api/skills/:name returns 404 for missing skill
  ✓ POST /api/skills/:name/run validates required input fields
  ✓ skill frontmatter must have name, description, input, output
  ✓ skill body is returned as raw markdown (prompt for Claude)
  ✓ POST /api/skills creates a new skill file
  ✓ PUT /api/skills/:name updates skill content
  ✓ DELETE /api/skills/:name removes skill file
```

#### 2.10 Settings UI

Configuration management.

**Tests:**
```
settings.test.tsx
  ✓ reads config from .scrypt/config.json
  ✓ displays editor settings: font size, tab size, auto-save delay
  ✓ displays vault settings: vault path, trash retention days
  ✓ displays plugin list with enable/disable toggles
  ✓ saving settings writes to config.json and applies immediately
  ✓ invalid config values show validation errors
  ✓ reset button restores defaults
```

---

## Out of Scope

- Multi-user / collaboration
- Cloud sync
- Mobile app
- WYSIWYG block editor
- Built-in AI (Claude operates externally via REST API or file edits)
- PDF/image annotation
- Dashboards / charts (future via skills + CSV data)
