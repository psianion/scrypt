#!/usr/bin/env bash
# scrypt guided install (macOS / Linux / WSL)
#
#   curl -fsSL https://raw.githubusercontent.com/psianion/scrypt/main/install.sh | bash
#
# Asks one question per setting (install dir, vault, hub, service, MCP), shows
# a summary, then: installs Bun if missing, clones or updates the repo, installs
# dependencies, builds the web UI, links the `scrypt` command, runs setup, and
# registers a user service. Safe to re-run.
#
# Every answer can be pre-seeded with an env var, and SCRYPT_YES=1 skips the
# questions entirely (CI, dotfiles). SCRYPT_DRY_RUN=1 shows the plan and stops.
#   SCRYPT_DIR  SCRYPT_VAULT  SCRYPT_HUB_URL  SCRYPT_AUTH_TOKEN
#   SCRYPT_NO_SERVICE=1  SCRYPT_NO_MCP=1
set -euo pipefail

REPO_URL="${SCRYPT_REPO_URL:-https://github.com/psianion/scrypt.git}"

bold()  { printf '\033[1m%s\033[0m' "$*"; }
say()   { printf '\033[1m==>\033[0m %s\n' "$*"; }
note()  { printf '    %s\n' "$*"; }
die()   { printf '\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }

# With `curl | bash` stdin is the script, so questions go through the
# terminal device instead. No terminal (CI) means defaults/env apply.
INTERACTIVE=0
if [ "${SCRYPT_YES:-0}" != "1" ] && [ -r /dev/tty ] && [ -w /dev/tty ]; then INTERACTIVE=1; fi

# ask VAR "question" "default"  -> sets VAR (env value, if set, is the default)
ask() {
  local var="$1" q="$2" def="${3-}" cur ans
  cur="${!var:-$def}"
  if [ "$INTERACTIVE" = 1 ]; then
    printf '\033[36m?\033[0m %s \033[2m[%s]\033[0m: ' "$q" "$cur" > /dev/tty
    IFS= read -r ans < /dev/tty || ans=""
    cur="${ans:-$cur}"
  fi
  printf -v "$var" '%s' "$cur"
}
# confirm "question" default(y|n) -> returns 0 for yes
confirm() {
  local q="$1" def="$2" ans
  if [ "$INTERACTIVE" != 1 ]; then [ "$def" = y ]; return; fi
  if [ "$def" = y ]; then printf '\033[36m?\033[0m %s \033[2m[Y/n]\033[0m: ' "$q" > /dev/tty; else printf '\033[36m?\033[0m %s \033[2m[y/N]\033[0m: ' "$q" > /dev/tty; fi
  IFS= read -r ans < /dev/tty || ans=""
  ans="${ans:-$def}"
  case "$ans" in y|Y|yes|YES) return 0;; *) return 1;; esac
}

command -v git  >/dev/null 2>&1 || die "git is required — install it and re-run."
command -v curl >/dev/null 2>&1 || die "curl is required — install it and re-run."

printf '\n%s\n' "$(bold 'scrypt setup')"
note "Markdown notes on disk, a local index, a browser UI, and an MCP server your tools can read and write."
printf '\n'

# ---- 1. where -------------------------------------------------------------
ask SCRYPT_DIR   "Install scrypt into"                          "$HOME/scrypt"
ask SCRYPT_VAULT "Folder for your notes (the vault)"           "$HOME/scrypt-vault"

# ---- 2. sync --------------------------------------------------------------
ROLE="${SCRYPT_HUB_URL:+join}"; ROLE="${ROLE:-standalone}"
if [ "$INTERACTIVE" = 1 ]; then
  printf '\033[36m?\033[0m Sync with other machines?\n' > /dev/tty
  printf '    1) Not now, or this machine will be the hub others sync to\n' > /dev/tty
  printf '    2) Join an existing hub over Tailscale\n' > /dev/tty
  printf '  choice \033[2m[%s]\033[0m: ' "$([ "$ROLE" = join ] && echo 2 || echo 1)" > /dev/tty
  IFS= read -r ans < /dev/tty || ans=""
  case "$ans" in 2) ROLE=join;; 1) ROLE=standalone;; esac
fi
if [ "$ROLE" = join ]; then
  ask SCRYPT_HUB_URL    "Hub URL (e.g. http://100.x.y.z:3777)" ""
  ask SCRYPT_AUTH_TOKEN "The hub's token (from the hub's .env)" ""
  [ -n "$SCRYPT_HUB_URL" ]    || die "a hub URL is needed to join a hub."
  [ -n "$SCRYPT_AUTH_TOKEN" ] || die "the hub's token is needed to join a hub."
else
  SCRYPT_HUB_URL=""
fi

# ---- 3. service + MCP -----------------------------------------------------
WANT_SERVICE=y; [ "${SCRYPT_NO_SERVICE:-0}" = 1 ] && WANT_SERVICE=n
confirm "Keep the server running after reboot (install a user service)?" "$WANT_SERVICE" && WANT_SERVICE=y || WANT_SERVICE=n

WANT_MCP=n
if command -v claude >/dev/null 2>&1; then
  WANT_MCP=y; [ "${SCRYPT_NO_MCP:-0}" = 1 ] && WANT_MCP=n
  confirm "Register the MCP server in Claude Code now?" "$WANT_MCP" && WANT_MCP=y || WANT_MCP=n
fi

# ---- summary --------------------------------------------------------------
printf '\n%s\n' "$(bold 'Plan')"
note "repo:     $SCRYPT_DIR"
note "vault:    $SCRYPT_VAULT"
if [ "$ROLE" = join ]; then note "sync:     join hub $SCRYPT_HUB_URL"; else note "sync:     none yet (this machine can be a hub later)"; fi
note "service:  $([ "$WANT_SERVICE" = y ] && echo 'yes, starts at login' || echo 'no — start with: scrypt up')"
note "MCP:      $([ "$WANT_MCP" = y ] && echo 'register in Claude Code' || echo 'skip (scrypt mcp install later)')"
printf '\n'
if [ "${SCRYPT_DRY_RUN:-0}" = 1 ]; then say "dry run — nothing installed."; exit 0; fi
confirm "Proceed?" y || { say "aborted — nothing installed."; exit 0; }
printf '\n'

# ---- run ------------------------------------------------------------------
export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
export PATH="$BUN_INSTALL/bin:$PATH"
if ! command -v bun >/dev/null 2>&1; then
  say "installing Bun"
  curl -fsSL https://bun.sh/install | bash >/dev/null
  command -v bun >/dev/null 2>&1 || die "Bun installed but not on PATH — open a new shell and re-run."
fi
say "bun $(bun --version)"

if [ -d "$SCRYPT_DIR/.git" ]; then
  say "updating $SCRYPT_DIR"; git -C "$SCRYPT_DIR" pull --ff-only
else
  say "cloning into $SCRYPT_DIR"; git clone "$REPO_URL" "$SCRYPT_DIR"
fi
cd "$SCRYPT_DIR"

say "installing dependencies"; bun install --frozen-lockfile
say "building the web UI";     bun run build
bun link >/dev/null 2>&1 || true

INIT_ARGS=(init --profile native --vault "$SCRYPT_VAULT" --yes)
[ -n "$SCRYPT_HUB_URL" ]          && INIT_ARGS+=(--hub "$SCRYPT_HUB_URL")
[ -n "${SCRYPT_AUTH_TOKEN:-}" ]   && INIT_ARGS+=(--token "$SCRYPT_AUTH_TOKEN")
[ "$WANT_MCP" = y ]               || INIT_ARGS+=(--no-mcp)
say "running: scrypt ${INIT_ARGS[*]}"
bun run src/cli/main.ts "${INIT_ARGS[@]}"

if [ "$WANT_SERVICE" = y ]; then
  say "installing the always-on service"
  bun run src/cli/main.ts down >/dev/null 2>&1 || true   # hand the port from the detached start to the service
  bun run src/cli/main.ts service install || say "service install failed — the server runs until you log out; start it later with: scrypt up"
fi

printf '\n%s\n' "$(bold 'scrypt is installed.')"
note "open:    http://localhost:3777"
note "vault:   $SCRYPT_VAULT"
note "cli:     cd \"$SCRYPT_DIR\" && bun run scrypt <command>   (or: scrypt <command> in a new shell)"
note "doctor:  scrypt doctor"
[ "$ROLE" = join ] && note "sync:    press Sync in the UI, or: scrypt sync pull"
exit 0
