# scrypt one-command install (Windows PowerShell)
#
#   irm https://raw.githubusercontent.com/psianion/scrypt/main/install.ps1 | iex
#
# What it does: installs Bun if missing, clones (or updates) the repo, installs
# dependencies, builds the web UI, puts a `scrypt` command on your PATH, runs
# the setup wizard, and registers a logon task so the server comes back after
# a reboot. Safe to re-run.
#
# Tunables (env vars): SCRYPT_DIR (default ~\scrypt), SCRYPT_VAULT (default
# ~\scrypt-vault), SCRYPT_HUB_URL, SCRYPT_AUTH_TOKEN, SCRYPT_NO_SERVICE=1.
$ErrorActionPreference = "Stop"

function Say($m) { Write-Host "==> $m" -ForegroundColor Cyan }
function Die($m) { Write-Host "error: $m" -ForegroundColor Red; exit 1 }

$RepoUrl = if ($env:SCRYPT_REPO_URL) { $env:SCRYPT_REPO_URL } else { "https://github.com/psianion/scrypt.git" }
$Dir     = if ($env:SCRYPT_DIR)   { $env:SCRYPT_DIR }   else { Join-Path $HOME "scrypt" }
$Vault   = if ($env:SCRYPT_VAULT) { $env:SCRYPT_VAULT } else { Join-Path $HOME "scrypt-vault" }

if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Die "git is required — install it (winget install Git.Git) and re-run." }

$BunBin = Join-Path $HOME ".bun\bin"
$env:Path = "$BunBin;$env:Path"
if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
  Say "installing Bun"
  Invoke-RestMethod https://bun.sh/install.ps1 | Invoke-Expression | Out-Null
  if (-not (Get-Command bun -ErrorAction SilentlyContinue)) { Die "Bun installed but not on PATH — open a new terminal and re-run." }
}
Say "bun $(bun --version)"

if (Test-Path (Join-Path $Dir ".git")) {
  Say "updating $Dir"
  git -C $Dir pull --ff-only
} else {
  Say "cloning into $Dir"
  git clone $RepoUrl $Dir
}
Set-Location $Dir

Say "installing dependencies"
bun install --frozen-lockfile
Say "building the web UI"
bun run build
try { bun link | Out-Null } catch { }

$initArgs = @("init", "--profile", "native", "--vault", $Vault)
if ($env:SCRYPT_HUB_URL)    { $initArgs += @("--hub", $env:SCRYPT_HUB_URL) }
if ($env:SCRYPT_AUTH_TOKEN) { $initArgs += @("--token", $env:SCRYPT_AUTH_TOKEN) }
# Piped through iex there is no interactive stdin; take the defaults.
if ([Console]::IsInputRedirected -or -not [Environment]::UserInteractive) { $initArgs += "--yes" }
Say "running: scrypt $($initArgs -join ' ')"
bun run src/cli/main.ts @initArgs

if ($env:SCRYPT_NO_SERVICE -ne "1") {
  Say "installing the always-on logon task"
  try { bun run src/cli/main.ts down | Out-Null } catch { }
  bun run src/cli/main.ts service install
}

Write-Host ""
Write-Host "scrypt is installed."
Write-Host "  repo:   $Dir"
Write-Host "  vault:  $Vault"
Write-Host "  open:   http://localhost:3777"
Write-Host "  cli:    cd `"$Dir`"; bun run scrypt <command>   (or: scrypt <command> in a new terminal)"
Write-Host "  doctor: scrypt doctor"
