#!/usr/bin/env bash
# scrypt one-command install (macOS / Linux / WSL)
#
#   curl -fsSL https://raw.githubusercontent.com/psianion/scrypt/main/install.sh | bash
#
# What it does: installs Bun if missing, clones (or updates) the repo, installs
# dependencies, builds the web UI, puts a `scrypt` command on your PATH, runs
# the setup wizard, and registers a user service so the server comes back
# after a reboot. Safe to re-run.
#
# Tunables (env vars):
#   SCRYPT_DIR         where to clone            (default ~/scrypt)
#   SCRYPT_VAULT       the notes folder          (default ~/scrypt-vault)
#   SCRYPT_HUB_URL     sync hub to join, e.g. http://100.x.y.z:3777 (default: none — this machine is standalone or the hub)
#   SCRYPT_AUTH_TOKEN  the hub's token when joining one (generated otherwise)
#   SCRYPT_NO_SERVICE  set to 1 to skip the always-on service
set -euo pipefail

REPO_URL="${SCRYPT_REPO_URL:-https://github.com/psianion/scrypt.git}"
DIR="${SCRYPT_DIR:-$HOME/scrypt}"
VAULT="${SCRYPT_VAULT:-$HOME/scrypt-vault}"

say()  { printf '\033[1m==>\033[0m %s\n' "$*"; }
die()  { printf '\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }

command -v git >/dev/null 2>&1 || die "git is required — install it and re-run."
command -v curl >/dev/null 2>&1 || die "curl is required — install it and re-run."

# Bun: the only runtime scrypt needs.
export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
export PATH="$BUN_INSTALL/bin:$PATH"
if ! command -v bun >/dev/null 2>&1; then
  say "installing Bun"
  curl -fsSL https://bun.sh/install | bash >/dev/null
  command -v bun >/dev/null 2>&1 || die "Bun installed but not on PATH — open a new shell and re-run."
fi
say "bun $(bun --version)"

# Repo: clone fresh, or fast-forward an existing checkout.
if [ -d "$DIR/.git" ]; then
  say "updating $DIR"
  git -C "$DIR" pull --ff-only
else
  say "cloning into $DIR"
  git clone "$REPO_URL" "$DIR"
fi
cd "$DIR"

say "installing dependencies"
bun install --frozen-lockfile
say "building the web UI"
bun run build
# `scrypt` on PATH (bun link is best-effort; `bun run scrypt` always works).
bun link >/dev/null 2>&1 || true

# Setup wizard. With stdin piped from curl there is no TTY, so defaults apply;
# the env tunables above are how you steer a non-interactive install.
INIT_ARGS=(init --profile native --vault "$VAULT")
[ -n "${SCRYPT_HUB_URL:-}" ]    && INIT_ARGS+=(--hub "$SCRYPT_HUB_URL")
[ -n "${SCRYPT_AUTH_TOKEN:-}" ] && INIT_ARGS+=(--token "$SCRYPT_AUTH_TOKEN")
[ -t 0 ] || INIT_ARGS+=(--yes)
say "running: scrypt ${INIT_ARGS[*]}"
bun run src/cli/main.ts "${INIT_ARGS[@]}"

if [ "${SCRYPT_NO_SERVICE:-0}" != "1" ]; then
  say "installing the always-on service"
  bun run src/cli/main.ts down >/dev/null 2>&1 || true   # hand the port from the detached start to the service
  bun run src/cli/main.ts service install || say "service install failed — the server is still running until you log out; start it later with: scrypt up"
fi

cat <<EOF

scrypt is installed.
  repo:   $DIR
  vault:  $VAULT
  open:   http://localhost:3777
  cli:    cd "$DIR" && bun run scrypt <command>   (or just: scrypt <command>, after opening a new shell)
  doctor: scrypt doctor
EOF
