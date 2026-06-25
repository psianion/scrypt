#!/usr/bin/env bash
#
# Thin shim — the MCP install logic now lives in the cross-platform TS CLI so it
# works identically on macOS, Linux, and Windows/PowerShell.
#
# Prefer:  scrypt mcp install [--name N] [--url U] [--scope SCOPE]
#     or:  bun run scrypt mcp install [...]
#
# This shim forwards to the same code path for existing muscle memory.

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
exec bun run "${ROOT}/src/cli/main.ts" mcp install "$@"
