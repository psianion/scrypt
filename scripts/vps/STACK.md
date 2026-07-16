# SUP Stack — VPS Runbook (scrypt + uxie + para-raid)

Stack-level topology, integration, backup, and maintenance reference for the
three SUP apps running on the single VPS host `para-raid` (alias in
`~/.ssh/config`, user `ubuntu`). Per-app deploy detail lives in each app's own
`scripts/vps/README.md`; this file is the map that ties them together.

## Topology

| | scrypt | uxie | para-raid |
|---|---|---|---|
| Plane | data (vault, chat/embeddings) | chat (Discord gateway bot) | orchestration (session daemon) |
| Deployed as | Docker container, image from GHCR (`ghcr.io/psianion/scrypt:latest`) | Docker container, image from GHCR (`ghcr.io/psianion/uxie:latest`) | native, systemd `--user` unit |
| Network surface | `127.0.0.1:3777` (+ optional Tailscale IP bind, see `SCRYPT_BIND_ADDR`) | `network_mode: host`, outbound-only — no listening port | unix socket only, no TCP |

**Zero public inbound surface.** No reverse proxy, no TLS certificates, no
service bound to `0.0.0.0` anywhere in the stack. Cross-host access (e.g. a
laptop reaching the vault) is Tailscale-only, over loopback-equivalent
addresses. If you find yourself reaching for nginx/Caddy or a cert, that's a
sign the design has drifted — stop and reconsider.

## Integration map

- **uxie → scrypt**: REST over loopback HTTP (`http://127.0.0.1:3777`),
  bearer auth (`SCRYPT_AUTH_TOKEN`, shared secret in both `scrypt.env` and
  `uxie.env`). Host networking on uxie makes the loopback hop possible without
  relaxing uxie's `https://`-except-loopback zod validation.
- **para-raid sessions → scrypt**: via the MCP bundle, `http://127.0.0.1:3777/mcp`.
  Same bearer token, configured in para-raid's MCP client config.
- **uxie ↔ para-raid**: `/raid` adapter leg, thread-per-session — implemented.
  para-raid's `[adapters.uxie]` section talks to uxie's webhook receiver;
  uxie's Discord commands drive para-raid's session API over the unix socket.
  See "Enabling uxie ↔ para-raid" below for the VPS wiring.

## Enabling uxie ↔ para-raid (`/raid` module)

Off by default — uxie's `PARARAID_*` env group is absent until you do this.

- **Socket path**: edit para-raid's `config.toml`, set `daemon.socket_path`
  to `~/.para-raid-run/para-raid.sock` (a dedicated home-dir path, not
  `$XDG_RUNTIME_DIR` — tmpfs, doesn't survive what you'd expect). Then
  `systemctl --user restart para-raid` — the unit doesn't hardcode the
  socket, so the daemon won't pick up the new path without a restart.
- **Bind-mount**: mount the `~/.para-raid-run` *directory* into the uxie
  container, not the socket file — the file's inode changes on every daemon
  restart, so a file-mount goes stale until the container is recreated.
  uid note: the container's `bun` user is uid 1000, same as `ubuntu` on the
  host, so the 0600 socket is readable as-is.
- **uxie env**: set the `PARARAID_*` block (socket path, adapter token,
  signing secret, webhook port) in `/opt/secrets/uxie.env`.
- **para-raid webhook_url**: para-raid's setup script only rewrites
  `[auth]`/`[signing]` in `config.toml` — it does not touch
  `[adapters.uxie].webhook_url`. Hand-edit it to
  `http://127.0.0.1:18901/api/webhooks/para-raid`; easy to miss, and the
  failure mode is silent (webhooks just never arrive). Works as-is under
  uxie's host networking, no extra port mapping needed.
- **Discord side**: toggle the MessageContent privileged intent for the bot
  in the Discord Developer Portal (uxie's gateway login fails with
  "disallowed intents" otherwise), and grant the bot Create Public Threads,
  Send Messages in Threads, and Add Reactions.

Operational notes:
- para-raid restarts — including every `update-para-raid` run — emit
  `session_recover_candidate` for in-flight sessions, and uxie auto-resumes
  them. Sessions survive updates.
- para-raid auto-pauses on Claude usage-limit warnings and RAM pressure; uxie
  posts the pause into every live session thread so it doesn't read as a dead
  bot. Resume on the host with `para-raid resume`.

## Filesystem layout

```
/home/ubuntu/scrypt/docker-compose.vps.yml       # scrypt container def
/home/ubuntu/uxie/docker-compose.vps.yml         # uxie container def
/home/ubuntu/para-raid/                          # native repo, systemd --user daemon
/home/ubuntu/para-raid/scrypt-vault/             # the vault (historical location — see below)
/opt/secrets/shared.env                          # GHCR creds, DISCORD_NOTIFY_WEBHOOK — chmod 600
/opt/secrets/scrypt.env                          # scrypt runtime env — chmod 600
/opt/secrets/uxie.env                            # uxie runtime env — chmod 600
/home/ubuntu/bin/update-scrypt                   # → scripts/vps/update-scrypt.sh
/home/ubuntu/bin/update-uxie                     # → uxie's scripts/vps/update-uxie.sh
/home/ubuntu/bin/update-para-raid                # → para-raid's scripts/vps/update-para-raid.sh
/home/ubuntu/bin/sup-notify                      # → scripts/vps/sup-notify (this repo)
/home/ubuntu/bin/vault-backup                    # → scripts/vps/vault-backup.sh (this repo)
/var/log/sup-updates/                            # update script logs, one file per app
/home/ubuntu/backups/vault/                      # vault-backup.sh output, 14-day retention
```

The vault lives inside para-raid's tree (`/home/ubuntu/para-raid/scrypt-vault`)
rather than somewhere scrypt-owned. This is historical, not accidental —
para-raid was provisioned first and the vault was bind-mounted into it. Moving
it now is a data migration for zero functional gain (see scrypt repo decision
D5). Don't move it without a deliberate migration plan.

## Update flows

Each app updates independently, triggered by a git tag:

| App | Trigger | VPS command |
|---|---|---|
| scrypt | `git tag vX.Y.Z && git push` → CI builds + pushes GHCR image | `~/bin/update-scrypt` |
| uxie | `git tag vX.Y.Z && git push` → CI builds + pushes GHCR image | `~/bin/update-uxie` |
| para-raid | `git push` to main (no tag/CI — it's a native `git pull`) | `~/bin/update-para-raid` |

Suggested nightly cron (stagger to avoid overlapping restarts):

```cron
0 2 * * *  /home/ubuntu/bin/update-scrypt
15 2 * * * /home/ubuntu/bin/update-uxie
30 2 * * * /home/ubuntu/bin/vault-backup
45 2 * * * /home/ubuntu/bin/update-para-raid
```

All three update scripts are idempotent (no-op when nothing changed), take a
pre-update snapshot (image digest or, for para-raid, DB files + git HEAD),
verify health after restart, and roll back automatically on failure. Every
rollback and every hard failure calls `~/bin/sup-notify` to post to the
Discord alert webhook — silent unless something needs attention.

## Backups & DR

**vault-backup.sh** runs nightly, tars `scrypt-vault` to
`/home/ubuntu/backups/vault/vault-<date>.tar.gz`, excludes `.scrypt/` (the
live SQLite FTS5 index + embeddings — torn-write hazard in a running
container, and it rebuilds from the `.md` files on next start), and prunes
anything older than 14 days.

Offsite options (neither is wired up automatically — pick one if the VPS
itself is a single point of failure you care about):
- rsync the nightly tarball to a tailnet device.
- Set `SCRYPT_GIT_AUTOCOMMIT=1` (value must be exactly the string `"1"`) in
  `scrypt.env` so the vault self-commits and can push to a private git remote.

para-raid's own DB (session state, `~/.local/state/para-raid`) is snapshotted
by `update-para-raid.sh` before every update purely as an update-rollback
safety net — it is not a durability guarantee. Treat it as rebuildable: a
lost para-raid DB costs re-running `para-raid setup`, not lost data.

**Recovery order after total VPS loss:**
1. **scrypt** — provision host, restore the latest vault tarball to
   `/home/ubuntu/para-raid/scrypt-vault`, `~/bin/update-scrypt` to pull +
   start the container (re-indexes/re-embeds from the restored `.md` files).
2. **para-raid** — clone the repo, run its setup script, `claude` login
   interactively (subscription auth, can't be scripted headlessly).
3. **uxie** — restore `/opt/secrets/uxie.env`, `~/bin/update-uxie` to pull +
   start the container.

scrypt goes first because para-raid and uxie both depend on it being up.

## Maintenance

- `docker image prune -f` runs at the end of every successful scrypt/uxie
  update (prevents disk fill from nightly image pulls on a small VPS).
- Enable `unattended-upgrades` on the host for OS/security patches — nothing
  in this stack manages host packages.
- The para-raid `--user` systemd unit's journal can grow unbounded under the
  default journald config. Cap it with a drop-in
  (`~/.config/systemd/user/para-raid.service.d/journal.conf` won't help —
  journald sizing is set in `journald.conf`; add
  `SystemMaxUse=200M` under `[Journal]` in
  `/etc/systemd/journald.conf.d/sup.conf` and `systemctl restart systemd-journald`).
- Growth watch-list — nothing here auto-prunes, check periodically:
  - scrypt's embed-cache volume (grows with vault size + model changes).
  - para-raid session workdirs (one per session, not auto-cleaned).
  - `~/.claude` transcripts (accumulate with every para-raid session).

## Secrets & rotation

| Secret | Location | Rotation |
|---|---|---|
| `SCRYPT_AUTH_TOKEN` | `/opt/secrets/scrypt.env` + `/opt/secrets/uxie.env` (must match) | Edit both files, recreate both containers (`docker compose up -d` picks up `env_file` changes), re-run the MCP install script on every client that talks to scrypt. |
| Discord bot token | `/opt/secrets/uxie.env` | Discord Developer Portal → regenerate → update `uxie.env` → recreate uxie container. |
| `GHCR_PAT` | `/opt/secrets/shared.env` | 90-day expiry. Before it lapses: issue a new PAT, update `shared.env`, `docker logout ghcr.io` (invalidate cached creds), next update script run re-logs-in. |
| claude subscription login | para-raid's user session | Re-run `claude` login interactively as the `ubuntu` user (no headless path — it refuses `ANTHROPIC_API_KEY`). Detect: `para-raid doctor` checks the login directly (its "claude logged in" check runs `claude auth status`). A lapse also surfaces at the next service restart — the daemon refuses to boot without a valid login, so the nightly updater's `status` gate fails and notifies. |
| `DISCORD_NOTIFY_WEBHOOK` | `/opt/secrets/shared.env` | Discord channel → Integrations → Webhooks → regenerate URL → update `shared.env`. Blank disables notifications; nothing else depends on it. |

## Dev on Windows

**Full-loop dev rig (all three apps native inside WSL2 Ubuntu):**
`scripts/dev/sup-dev.sh up | down | status` starts/stops the whole stack —
para-raid via its systemd --user unit, scrypt + uxie as named bun processes
with logs in `~/.local/state/sup-dev/`. Assumes clones at `~/scrypt ~/uxie
~/para-raid` with deps + `.env` in place (see the 2026-07-16 E2E notes in
labs-docs/sup/). The split below remains the light option when para-raid
isn't needed.

- **scrypt**: run its own `docker-compose.yml` (dev, not `.vps.yml`), serves
  `localhost:3777`. This stays canonical for day-to-day MCP use regardless of
  what's on the VPS.
- **uxie**: `bun run dev` natively against the local scrypt instance above —
  don't run uxie in Docker locally, `network_mode: host` semantics mean it
  can't reach scrypt's container the same way prod does, and `bun --hot` is
  the better dev loop anyway.
- **para-raid**: requires WSL2 — it needs tmux and a real unix socket, neither
  of which Windows provides natively. Run it inside a WSL2 distro; systemd
  `--user` (or a tmux session standing in for it) works the same as on the VPS
  from there.
