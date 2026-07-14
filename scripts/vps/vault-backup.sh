#!/usr/bin/env bash
# vault-backup — nightly tar.gz snapshot of the scrypt vault, 14-day retention.
#
# Excludes .scrypt/ (the SQLite FTS5 index + embeddings): it's a live database,
# tarring it mid-write risks a torn/corrupt file, and it fully rebuilds from
# the .md files on next scrypt start anyway. Tradeoff: restore pays a full
# re-index/re-embed pass instead of a warm cache.
#
# Cron: 30 2 * * * /home/ubuntu/bin/vault-backup

set -euo pipefail

VAULT_DIR=/home/ubuntu/para-raid
VAULT_NAME=scrypt-vault
BACKUP_DIR=/home/ubuntu/backups/vault
DATE=$(date +%F)

notify() {
  [ -x "$HOME/bin/sup-notify" ] && "$HOME/bin/sup-notify" "vault-backup FAILED: $1" || true
}

mkdir -p "$BACKUP_DIR" || { notify "mkdir $BACKUP_DIR failed"; exit 1; }

# Single-instance lock — overlapping runs would interleave writes into the same tarball.
exec 9>"$BACKUP_DIR/.lock"
flock -n 9 || { notify "another vault-backup run is in progress"; exit 1; }

# Write to a temp name and mv into place so a killed run never leaves a
# truncated tarball sitting at the final name looking like a good backup.
TMP="$BACKUP_DIR/vault-$DATE.tar.gz.tmp"
if ! tar -czf "$TMP" --exclude='.scrypt' -C "$VAULT_DIR" "$VAULT_NAME"; then
  notify "tar failed for $DATE"
  rm -f "$TMP"
  exit 1
fi
mv "$TMP" "$BACKUP_DIR/vault-$DATE.tar.gz"

find "$BACKUP_DIR" \( -name 'vault-*.tar.gz' -mtime +14 -o -name '*.tmp' -mtime +1 \) -delete
