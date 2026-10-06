# Scrypt

Local-first markdown notes vault: Bun server + Vite/React client + PixiJS knowledge graph + MCP server.

## Stack (this repo deviates from Bun defaults — do NOT "fix" these)

- Runtime: Bun (`bun run`, `bun test`). No Node, no npm.
- Client: **Vite** builds/serves the React app (`vite.config.ts`). Vite is intentional here despite Bun's HTML-imports feature.
- Server: `src/server/index.ts` on Bun, domain folders per subsystem (api, graph, indexer, sync, embeddings, mcp, …).
- State: zustand — one main store (`src/client/store.ts`) + focused stores in `src/client/stores/`.
- Styling: Tailwind v4 + hand-written component CSS sharing one token set.

## Commands

- `bun run dev` — server (hot), `bun run dev:client` — Vite dev server
- `bun run build` — production client build
- `bun test tests/client/` (or `test:server`, `test:cli`, `test` for all)

## Client layout

- `src/client/ui/` — design-system primitives (Button, Input, Modal, Chip, …), CSS co-located per component, barrel exports.
- `src/client/components/` — app chrome (Sidebar, TabBar, StatusBar, CommandPalette).
- `src/client/views/` — routes. GraphView is the one lazy-loaded chunk.
- `src/client/theme/` — `tokens.css` (single source of color/space/motion/z tokens, dark default + `[data-theme="light"]` overrides), `fonts.css` (self-hosted woff2 in `theme/fonts/`).

## Design system rules

- Never hard-code colors; use `var(--*)` tokens. Tints derive via `color-mix(in srgb, var(--token) N%, transparent)` so light theme re-derives them.
- Light theme overrides every accent/semantic token — if you add a token, add its light value and keep text ≥4.5:1 contrast.
- Text painted on accent fills uses `--on-accent`. Links use `--link`. Z-index uses `--z-*` tokens only.
- Motion: `--dur-*`/`--ease-*` tokens, 150–250ms, transform/opacity only (no width/height/margin animation). A global `prefers-reduced-motion` override lives in `main.css`.
- Every interactive element needs hover + `:focus-visible` states.
- Some CSS headers reference `docs/pencils/*.md` spec docs — those files do not exist in this repo; the CSS itself is the source of truth.

## Conventions

- Desktop-first UI; narrow-window fallbacks live at the bottom of `main.css`.
- View-specific CSS is co-located with its component, never added to `main.css`.
