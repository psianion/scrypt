#!/usr/bin/env bash
#
# Installs the Scrypt MCP server into Claude Code via the streamable-http
# transport (POST /mcp on the Scrypt container).
#
# Usage:
#   scripts/install-scrypt-mcp.sh [--name NAME] [--url URL] [--scope SCOPE]
#
# Defaults:
#   NAME  = scrypt
#   URL   = http://localhost:3777/mcp
#   SCOPE = user       (user | project | local)
#
# The script reads SCRYPT_AUTH_TOKEN from ./.env if present. In dev mode
# (NODE_ENV=development) the server bypasses auth for localhost, so the
# header is optional — we still set it if we find one, so the same
# installed entry keeps working when the container is flipped to
# production mode.
#
# Idempotent: removes any prior entry with the same name before adding.

set -euo pipefail

NAME="scrypt"
URL="http://localhost:3777/mcp"
SCOPE="user"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --name)  NAME="$2";  shift 2 ;;
    --url)   URL="$2";   shift 2 ;;
    --scope) SCOPE="$2"; shift 2 ;;
    -h|--help)
      sed -n '2,18p' "$0"
      exit 0
      ;;
    *)
      echo "unknown flag: $1" >&2
      exit 2
      ;;
  esac
done

if ! command -v claude >/dev/null 2>&1; then
  echo "error: claude CLI not on PATH" >&2
  exit 1
fi

# Resolve the repo root (the dir containing .env and this script's parent).
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${ROOT}/.env"

TOKEN=""
if [[ -f "$ENV_FILE" ]]; then
  # Grab the SCRYPT_AUTH_TOKEN line without sourcing the whole file.
  TOKEN="$(grep -E '^SCRYPT_AUTH_TOKEN=' "$ENV_FILE" | head -n1 | cut -d= -f2- || true)"
fi

echo ">> reachability check: $URL"
HTTP_CODE="$(curl -sS -o /dev/null -w '%{http_code}' \
  -X POST "$URL" \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":0,"method":"tools/list"}' || true)"
if [[ "$HTTP_CODE" != "200" ]]; then
  echo "error: POST $URL returned HTTP $HTTP_CODE" >&2
  echo "       is the scrypt container running on that port?" >&2
  exit 1
fi
echo "   ok — POST $URL → 200"

echo ">> removing any existing '$NAME' entry (--scope $SCOPE)"
claude mcp remove "$NAME" --scope "$SCOPE" 2>/dev/null || true

echo ">> adding '$NAME' → $URL (--scope $SCOPE)"
if [[ -n "$TOKEN" ]]; then
  echo "   attaching Authorization: Bearer ****${TOKEN: -6}"
  claude mcp add --transport http "$NAME" "$URL" \
    --scope "$SCOPE" \
    --header "Authorization: Bearer ${TOKEN}"
else
  echo "   no SCRYPT_AUTH_TOKEN in $ENV_FILE — installing without a bearer header"
  echo "   (dev-mode localhost bypass will still let requests through)"
  claude mcp add --transport http "$NAME" "$URL" --scope "$SCOPE"
fi

echo ""
echo ">> verifying:"
claude mcp list
echo ""
echo ">> details:"
claude mcp get "$NAME" || true

echo ""
echo "done. 12 Scrypt tools should now be visible in a fresh Claude Code session."
