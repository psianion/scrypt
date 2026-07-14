#!/usr/bin/env bash
# update-scrypt — pull latest scrypt image from GHCR, restart, healthcheck, rollback on failure.
#
# Idempotent. Safe to run multiple times. Single-instance via flock.
# Logs every run to /var/log/sup-updates/scrypt.log with ISO-8601 timestamps.
#
# Exit codes:
#   0  success (or no-op when image unchanged)
#   1  healthcheck failed (rollback attempted)
#   2  pull / login failed
#   3  another instance already running
#   4  misconfiguration (missing secrets, missing compose file)
#
# Install:
#   sudo install -m 0755 -o ubuntu -g ubuntu \
#     scripts/vps/update-scrypt.sh /home/ubuntu/bin/update-scrypt
#
# Run:
#   ~/bin/update-scrypt          # manual
#   crontab -e  → 0 2 * * * /home/ubuntu/bin/update-scrypt   # nightly

set -euo pipefail

LOG_DIR=/var/log/sup-updates
LOG=$LOG_DIR/scrypt.log
COMPOSE=/home/ubuntu/scrypt/docker-compose.vps.yml
IMAGE=ghcr.io/psianion/scrypt:latest
HEALTH_URL=http://localhost:3777/health
LOCK=/var/lock/update-scrypt.lock
SECRETS=/opt/secrets/shared.env

mkdir -p "$LOG_DIR"

log()  { printf '[%s] %s\n' "$(date -Iseconds)" "$*" | tee -a "$LOG" >&2; }
fail() {
  log "FAIL: $1"
  # STACK.md guarantee: every hard failure notifies (expired GHCR_PAT etc. must not die silently under cron).
  [ -x "$HOME/bin/sup-notify" ] && "$HOME/bin/sup-notify" "update-scrypt FAILED: $1" || true
  exit "${2:-1}"
}

# Single-instance lock — prevents cron + manual collision and concurrent restarts.
exec 9>"$LOCK"
flock -n 9 || fail "another update-scrypt run is in progress" 3

log "=== update-scrypt start (uid=$(id -u) host=$(hostname)) ==="

[[ -r "$SECRETS" ]] || fail "missing or unreadable $SECRETS — see runbook §bootstrap" 4
# shellcheck disable=SC1090
source "$SECRETS"
[[ -n "${GHCR_PAT:-}" && -n "${GHCR_USER:-}" ]] \
  || fail "GHCR_PAT / GHCR_USER not set in $SECRETS" 4

[[ -r "$COMPOSE" ]] || fail "compose file not found: $COMPOSE" 4

# Capture pre-state for rollback + audit trail.
PREV_IMAGE_ID=$(docker inspect --format='{{.Image}}' scrypt-vault 2>/dev/null || echo "none")
PREV_DIGEST=$(docker inspect --format='{{index .RepoDigests 0}}' "$PREV_IMAGE_ID" 2>/dev/null || echo "none")
log "pre: container_image_id=$PREV_IMAGE_ID digest=$PREV_DIGEST"

log "logging in to ghcr.io as $GHCR_USER"
echo "$GHCR_PAT" | docker login ghcr.io -u "$GHCR_USER" --password-stdin >/dev/null 2>&1 \
  || fail "docker login failed — check GHCR_PAT in $SECRETS" 2

log "pulling $IMAGE"
docker pull "$IMAGE" >> "$LOG" 2>&1 || fail "docker pull failed" 2

NEW_DIGEST=$(docker inspect --format='{{index .RepoDigests 0}}' "$IMAGE" 2>/dev/null || echo "unknown")
log "post-pull: new_digest=$NEW_DIGEST"

# Idempotency: if the image hash hasn't changed, do nothing.
if [[ "$PREV_DIGEST" == "$NEW_DIGEST" && "$PREV_DIGEST" != "none" ]]; then
  log "no-op: image unchanged ($NEW_DIGEST)"
  log "=== update-scrypt done (no-op) ==="
  exit 0
fi

log "restarting container with new image"
docker compose -f "$COMPOSE" up -d --remove-orphans >> "$LOG" 2>&1 \
  || fail "docker compose up failed" 1

# Healthcheck with retries — startup of FTS5 + embeddings can take a few seconds.
log "healthchecking $HEALTH_URL (10 attempts, 2s apart)"
healthy=false
for i in $(seq 1 10); do
  if curl -fsS --max-time 3 "$HEALTH_URL" >/dev/null 2>&1; then
    healthy=true
    log "healthcheck OK on attempt $i"
    break
  fi
  sleep 2
done

if ! $healthy; then
  log "healthcheck FAILED after 10 attempts"
  log "--- last 50 container log lines ---"
  docker logs --tail 50 scrypt-vault >> "$LOG" 2>&1 || true
  log "-----------------------------------"

  if [[ "$PREV_IMAGE_ID" != "none" ]]; then
    log "rolling back container image to $PREV_IMAGE_ID"
    docker tag "$PREV_IMAGE_ID" "$IMAGE"
    docker compose -f "$COMPOSE" up -d >> "$LOG" 2>&1 || true
    log "rollback dispatched; manually verify with: curl $HEALTH_URL"
    [ -x "$HOME/bin/sup-notify" ] && "$HOME/bin/sup-notify" "scrypt update rolled back: healthcheck failed after pulling $NEW_DIGEST" || true
  else
    log "no previous image to roll back to — manual intervention required"
    [ -x "$HOME/bin/sup-notify" ] && "$HOME/bin/sup-notify" "scrypt update FAILED: no previous image to roll back to (digest $NEW_DIGEST) — manual intervention required" || true
  fi
  exit 1
fi

log "pruning dangling images"
docker image prune -f >> "$LOG" 2>&1 || true

log "=== update-scrypt done (digest=$NEW_DIGEST) ==="
