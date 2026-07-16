#!/usr/bin/env bash
# sup-dev.sh — up | down | status for the local SUP dev stack inside WSL.
#
# Assumes the WSL rig layout from the 2026-07-16 E2E session:
#   ~/scrypt ~/uxie ~/para-raid   (clones, deps installed, .env files present)
#   para-raid installed as a systemd --user unit
# Logs land in ~/.local/state/sup-dev/{scrypt,uxie}.log — tail those for
# debugging instead of fighting stdout pipes.
#
# Usage:  sup-dev.sh up | down | status
set -u

BUN="$HOME/.bun/bin/bun"
LOG_DIR="$HOME/.local/state/sup-dev"
SCRYPT_DIR="${SUP_SCRYPT_DIR:-$HOME/scrypt}"
UXIE_DIR="${SUP_UXIE_DIR:-$HOME/uxie}"
mkdir -p "$LOG_DIR"

start_proc() { # name dir logfile
  local name="$1" dir="$2" log="$3"
  if pgrep -f "$name" >/dev/null; then
    echo "$name: already running"
    return 0
  fi
  (cd "$dir" && nohup bash -c "exec -a $name '$BUN' run dev" >>"$log" 2>&1 &)
  echo "$name: started (log: $log)"
}

wait_for() { # label check-command timeout-seconds
  local label="$1" check="$2" deadline=$(( $(date +%s) + $3 ))
  until eval "$check" >/dev/null 2>&1; do
    if [ "$(date +%s)" -ge "$deadline" ]; then
      echo "$label: NOT READY after ${3}s — check logs" >&2
      return 1
    fi
    sleep 1
  done
  echo "$label: ready"
}

case "${1:-status}" in
  up)
    systemctl --user start para-raid
    start_proc scrypt-dev "$SCRYPT_DIR" "$LOG_DIR/scrypt.log"
    start_proc uxie-dev "$UXIE_DIR" "$LOG_DIR/uxie.log"
    rc=0
    wait_for "para-raid" "systemctl --user is-active --quiet para-raid" 15 || rc=1
    wait_for "scrypt"    "curl -sf -m 2 http://127.0.0.1:3777/health" 60 || rc=1
    wait_for "uxie"      "grep -q 'uxie ready' '$LOG_DIR/uxie.log'" 60 || rc=1
    exit $rc
    ;;
  down)
    pkill -f uxie-dev   && echo "uxie: stopped"   || echo "uxie: not running"
    pkill -f scrypt-dev && echo "scrypt: stopped" || echo "scrypt: not running"
    systemctl --user stop para-raid && echo "para-raid: stopped"
    # claude worker panes are daemon children only by adoption — reap them too
    tmux kill-server 2>/dev/null && echo "tmux workers: killed" || true
    ;;
  status)
    systemctl --user is-active --quiet para-raid \
      && echo "para-raid: active" || echo "para-raid: stopped"
    pgrep -f scrypt-dev >/dev/null && echo "scrypt: running" || echo "scrypt: stopped"
    curl -sf -m 2 http://127.0.0.1:3777/health >/dev/null \
      && echo "scrypt health: ok" || echo "scrypt health: unreachable"
    pgrep -f uxie-dev >/dev/null && echo "uxie: running" || echo "uxie: stopped"
    tmux ls 2>/dev/null | sed 's/^/worker pane: /' || echo "worker panes: none"
    ;;
  *)
    echo "usage: sup-dev.sh up | down | status" >&2
    exit 2
    ;;
esac
