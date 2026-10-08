# scrypt guided install (Windows PowerShell)
#
#   irm https://raw.githubusercontent.com/psianion/scrypt/main/install.ps1 | iex
#
# Asks one question per setting (install dir, vault, hub, service, MCP), shows
# a summary, then: installs Bun if missing, clones or updates the repo, installs
# dependencies, builds the web UI, links the `scrypt` command, runs setup, and
# registers a logon task. Safe to re-run.
#
# Every answer can be pre-seeded with an env var, and SCRYPT_YES=1 skips the
# questions entirely. SCRYPT_DRY_RUN=1 shows the plan and stops.
#   SCRYPT_DIR  SCRYPT_VAULT  SCRYPT_HUB_URL  SCRYPT_AUTH_TOKEN
#   SCRYPT_NO_SERVICE=1  SCRYPT_NO_MCP=1
$ErrorActionPreference = "Stop"
$RepoUrl = if ($env:SCRYPT_REPO_URL) { $env:SCRYPT_REPO_URL } else { "https://github.com/psianion/scrypt.git" }

function Say($m)  { Write-Host "==> $m" -ForegroundColor Cyan }
function Note($m) { Write-Host "    $m" }
function Die($m)  { Write-Host "error: $m" -ForegroundColor Red; exit 1 }

$Interactive = ($env:SCRYPT_YES -ne "1") -and [Environment]::UserInteractive
function Ask($question, $default) {
  if (-not $Interactive) { return $default }
  $ans = Read-Host "? $question [$default]"
  if ([string]::IsNullOrWhiteSpace($ans)) { return $default } else { return $ans.Trim() }
}
function Confirm($question, [bool]$default) {
  if (-not $Interactive) { return $default }
  $hint = if ($default) { "Y/n" } else { "y/N" }
  $ans = Read-Host "? $question [$hint]"
  if ([string]::IsNullOrWhiteSpace($ans)) { return $default }
  return $ans.Trim().ToLower() -in @("y", "yes")
}

if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Die "git is required - install it (winget install Git.Git) and re-run." }

Write-Host ""
Write-Host "scrypt setup" -ForegroundColor White
Note "Markdown notes on disk, a local index, a browser UI, and an MCP server your tools can read and write."
Write-Host ""

# ---- 1. where ---------------------------------------------------------------
$Dir   = Ask "Install scrypt into"                 $(if ($env:SCRYPT_DIR)   { $env:SCRYPT_DIR }   else { Join-Path $HOME "scrypt" })
$Vault = Ask "Folder for your notes (the vault)"  $(if ($env:SCRYPT_VAULT) { $env:SCRYPT_VAULT } else { Join-Path $HOME "scrypt-vault" })

# ---- 2. sync ----------------------------------------------------------------
$Role = if ($env:SCRYPT_HUB_URL) { "join" } else { "standalone" }
if ($Interactive) {
  Write-Host "? Sync with other machines?"
  Write-Host "    1) Not now, or this machine will be the hub others sync to"
  Write-Host "    2) Join an existing hub over Tailscale"
  $choice = Read-Host "  choice [$(if ($Role -eq 'join') { 2 } else { 1 })]"
  if ($choice -eq "2") { $Role = "join" } elseif ($choice -eq "1") { $Role = "standalone" }
}
$HubUrl = ""; $HubToken = ""
if ($Role -eq "join") {
  $HubUrl   = Ask "Hub URL (e.g. http://100.x.y.z:3777)"   $(if ($env:SCRYPT_HUB_URL)    { $env:SCRYPT_HUB_URL }    else { "" })
  $HubToken = Ask "The hub's token (from the hub's .env)"  $(if ($env:SCRYPT_AUTH_TOKEN) { $env:SCRYPT_AUTH_TOKEN } else { "" })
  if (-not $HubUrl)   { Die "a hub URL is needed to join a hub." }
  if (-not $HubToken) { Die "the hub's token is needed to join a hub." }
}

# ---- 3. service + MCP -------------------------------------------------------
$WantService = Confirm "Keep the server running after reboot (install a logon task)?" ($env:SCRYPT_NO_SERVICE -ne "1")
$WantMcp = $false
if (Get-Command claude -ErrorAction SilentlyContinue) {
  $WantMcp = Confirm "Register the MCP server in Claude Code now?" ($env:SCRYPT_NO_MCP -ne "1")
}

# ---- summary ----------------------------------------------------------------
Write-Host ""
Write-Host "Plan" -ForegroundColor White
Note "repo:     $Dir"
Note "vault:    $Vault"
Note "sync:     $(if ($Role -eq 'join') { "join hub $HubUrl" } else { 'none yet (this machine can be a hub later)' })"
Note "service:  $(if ($WantService) { 'yes, starts at logon' } else { 'no - start with: scrypt up' })"
Note "MCP:      $(if ($WantMcp) { 'register in Claude Code' } else { 'skip (scrypt mcp install later)' })"
Write-Host ""
if ($env:SCRYPT_DRY_RUN -eq "1") { Say "dry run - nothing installed."; exit 0 }
if (-not (Confirm "Proceed?" $true)) { Say "aborted - nothing installed."; exit 0 }
Write-Host ""

# ---- run --------------------------------------------------------------------
$BunBin = Join-Path $HOME ".bun\bin"
$env:Path = "$BunBin;$env:Path"
if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
  Say "installing Bun"
  Invoke-RestMethod https://bun.sh/install.ps1 | Invoke-Expression | Out-Null
  if (-not (Get-Command bun -ErrorAction SilentlyContinue)) { Die "Bun installed but not on PATH - open a new terminal and re-run." }
}
Say "bun $(bun --version)"

if (Test-Path (Join-Path $Dir ".git")) { Say "updating $Dir"; git -C $Dir pull --ff-only }
else { Say "cloning into $Dir"; git clone $RepoUrl $Dir }
Set-Location $Dir

Say "installing dependencies"; bun install --frozen-lockfile
Say "building the web UI";     bun run build
try { bun link | Out-Null } catch { }

$initArgs = @("init", "--profile", "native", "--vault", $Vault, "--yes")
if ($HubUrl)   { $initArgs += @("--hub", $HubUrl) }
if ($HubToken) { $initArgs += @("--token", $HubToken) }
if (-not $WantMcp) { $initArgs += "--no-mcp" }
Say "running: scrypt $($initArgs -join ' ')"
bun run src/cli/main.ts @initArgs

if ($WantService) {
  Say "installing the always-on logon task"
  try { bun run src/cli/main.ts down | Out-Null } catch { }
  bun run src/cli/main.ts service install
}

Write-Host ""
Write-Host "scrypt is installed." -ForegroundColor White
Note "open:    http://localhost:3777"
Note "vault:   $Vault"
Note "cli:     cd `"$Dir`"; bun run scrypt <command>   (or: scrypt <command> in a new terminal)"
Note "doctor:  scrypt doctor"
if ($Role -eq "join") { Note "sync:    press Sync in the UI, or: scrypt sync pull" }
