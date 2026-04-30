# scripts/vps — Scrypt VPS runbook

Production deploy of Scrypt onto the para-raid VPS. Image is pulled from GHCR
(`ghcr.io/psianion/scrypt:latest`), built by `.github/workflows/release.yml` on
git tag `vX.Y.Z`.

## Topology

- VPS host: `para-raid` (alias in `~/.ssh/config`)
- Container: `scrypt-vault`, listening on `127.0.0.1:3777`
- Vault volume: `/home/ubuntu/para-raid/scrypt-vault` → `/vault`
- Cross-host access: Tailscale only — never bind `0.0.0.0`

The local Docker instance on the laptop (`localhost:3777`) is independent and
stays canonical for day-to-day MCP use. See
`memory/project_scrypt_vps_deployment.md`.

## §bootstrap — first-time setup on a fresh VPS

Run once per host. Idempotent: re-running is safe.

```bash
# 1. Compose file
sudo mkdir -p /home/ubuntu/scrypt
sudo install -m 0644 -o ubuntu -g ubuntu \
  docker-compose.vps.yml /home/ubuntu/scrypt/docker-compose.vps.yml

# 2. Vault directory (or symlink to a Para-RAID-managed path)
sudo mkdir -p /home/ubuntu/para-raid/scrypt-vault
sudo chown -R ubuntu:ubuntu /home/ubuntu/para-raid/scrypt-vault

# 3. Secrets — copy templates and fill values
sudo mkdir -p /opt/secrets
sudo install -m 0600 -o ubuntu -g ubuntu \
  scripts/vps/shared.env.example /opt/secrets/shared.env
sudo install -m 0600 -o ubuntu -g ubuntu \
  scripts/vps/scrypt.env.example /opt/secrets/scrypt.env
sudo -u ubuntu vi /opt/secrets/shared.env  # set GHCR_PAT
sudo -u ubuntu vi /opt/secrets/scrypt.env  # set SCRYPT_AUTH_TOKEN

# 4. Update script
sudo install -m 0755 -o ubuntu -g ubuntu \
  scripts/vps/update-scrypt.sh /home/ubuntu/bin/update-scrypt

# 5. Log directory
sudo mkdir -p /var/log/sup-updates
sudo chown ubuntu:ubuntu /var/log/sup-updates

# 6. First pull + start
~/bin/update-scrypt
```

## Update flow

Tag locally → CI publishes image → run update on VPS:

```bash
# laptop
git tag v1.4.3 && git push origin v1.4.3

# VPS
ssh para-raid '~/bin/update-scrypt'
```

Or schedule nightly:

```cron
0 2 * * * /home/ubuntu/bin/update-scrypt
```

`update-scrypt` is idempotent (no-op when image digest is unchanged) and will
roll back automatically if the post-restart healthcheck fails.

## Healthcheck

`GET /health` → `200 {"ok":true}`. Outside the auth gate so unauthenticated
loopback probes (Docker, cron) work in production. Don't add dependency checks
to this endpoint — restart cascades will hide root causes.

## Token rotation

1. Edit `/opt/secrets/scrypt.env`, replace `SCRYPT_AUTH_TOKEN`.
2. `docker compose -f /home/ubuntu/scrypt/docker-compose.vps.yml up -d`
   (compose picks up env_file changes on recreate).
3. Re-run `scripts/install-scrypt-mcp.sh` on each client to update the bearer
   header.

## GHCR PAT rotation

`shared.env` holds `GHCR_PAT`. Replace before expiry (90-day default), then:

```bash
docker logout ghcr.io   # invalidate cached creds
~/bin/update-scrypt     # re-login + pull with new PAT
```

## Logs

- Update history: `/var/log/sup-updates/scrypt.log`
- Container logs: `docker logs scrypt-vault` (json-file driver, 10MB × 5 rotation)
