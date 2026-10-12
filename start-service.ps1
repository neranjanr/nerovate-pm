#Requires -Version 5.1
<#
.SYNOPSIS
  Start the Nerovate-PM stack (backend + frontend + Caddy) via Docker Compose.
.EXAMPLE
  .\start-service.ps1
  .\start-service.ps1 -Rebuild
  .\start-service.ps1 -Rebuild -FollowLogs
  .\start-service.ps1 -HostPort 8080   # host port 80 held by System/IIS
#>
[CmdletBinding()]
param(
  [switch]$Rebuild,
  [switch]$FollowLogs,
  [int[]]$Ports = @(8083),
  [int]$HostPort = 8083
)

$ErrorActionPreference = "Stop"

# Interactive menu if no startup switches are explicitly passed
if (-not $PSBoundParameters.ContainsKey('Rebuild') -and -not $PSBoundParameters.ContainsKey('FollowLogs')) {
  Write-Host "========================================" -ForegroundColor Cyan
  Write-Host "       Nerovate-PM Startup Menu         " -ForegroundColor Cyan
  Write-Host "========================================" -ForegroundColor Cyan
  Write-Host "  1) Normal Start (docker compose up -d)"
  Write-Host "  2) Rebuild Start (docker compose up -d --build)"
  Write-Host "  3) Rebuild + Follow Logs"
  Write-Host "  4) Exit"
  Write-Host ""
  $choice = Read-Host "Select option [1-4]"
  switch ($choice.Trim()) {
    "1" { 
      $Rebuild = $false
      $FollowLogs = $false 
    }
    "2" { 
      $Rebuild = $true
      $FollowLogs = $false 
    }
    "3" { 
      $Rebuild = $true
      $FollowLogs = $true 
    }
    "4" { 
      Write-Host "Exiting."
      exit 0
    }
    default {
      Write-Host "Invalid choice, defaulting to Normal Start (1)." -ForegroundColor Yellow
      $Rebuild = $false
      $FollowLogs = $false
    }
  }
}

function Test-PortHeld {
  param([int]$Port)
  $ls = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  if (-not $ls) { return $false }
  foreach ($l in $ls) {
    if ($l.OwningProcess -eq 0) { continue }
    if ($l.OwningProcess -eq 4) { return $true }
    $p = Get-Process -Id $l.OwningProcess -ErrorAction SilentlyContinue
    if ($p -and ($p.ProcessName -match "^(docker|com\.docker.*|vpnkit|wsl|wslhost)$")) { continue }
    return $true
  }
  return $false
}

function Free-ListeningPort {
  param([int]$Port)
  $listeners = @()
  try {
    $listeners = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  } catch {
    Write-Warning "Could not query port $Port listeners (need admin?): $($_.Exception.Message)"
    return
  }
  if (-not $listeners) { return }
  foreach ($l in ($listeners | Sort-Object OwningProcess -Unique)) {
    $ownerPid = $l.OwningProcess
    if ($ownerPid -eq 0 -or $ownerPid -eq 4) {
      Write-Warning "Port $Port is held by System (PID 4, HTTP.sys/IIS). Stop it with: net stop http (admin) or free port 80 before retrying."
      continue
    }
    $proc = $null
    try { $proc = Get-Process -Id $ownerPid -ErrorAction SilentlyContinue } catch { $proc = $null }
    if (-not $proc) { continue }
    if ($proc.ProcessName -match "^(docker|com\.docker.*|vpnkit|wsl|wslhost)$") {
      Write-Host "Port $Port is held by $($proc.ProcessName) (PID $ownerPid); leaving it for Docker to replace via compose up."
      continue
    }
    Write-Host "Port $Port in use by $($proc.ProcessName) (PID $ownerPid); stopping it..."
    try {
      Stop-Process -Id $ownerPid -Force -ErrorAction Stop
    } catch {
      Write-Warning "Could not stop PID $ownerPid on port ${Port}: $($_.Exception.Message)"
    }
  }
  for ($i = 1; $i -le 10; $i++) {
    Start-Sleep -Milliseconds 500
    $still = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
      Where-Object { $_.OwningProcess -ne 0 -and $_.OwningProcess -ne 4 }
    if (-not $still) { break }
    if ($i -eq 10) {
      Write-Warning "Port $Port is still in use after kill attempts. Compose up may fail with 'port is already allocated'."
    }
  }
}

# Always run relative to this script (repo root).
$RepoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Push-Location -LiteralPath $RepoRoot
try {
  # 1. Preflight: docker must exist and be running.
  if (-not (Get-Command "docker" -ErrorAction SilentlyContinue)) {
    throw "Docker was not found on PATH. Install Docker Desktop and retry."
  }
  # NOTE: docker prints cgroup/blkio WARNINGs to stderr even when healthy.
  # Run via cmd so PowerShell ($ErrorActionPreference=Stop) never converts
  # that stderr text into a terminating error; judge only by exit code.
  & cmd /c "docker info >NUL 2>&1"
  if ($LASTEXITCODE -ne 0) {
    throw "Docker daemon is not reachable. Start Docker Desktop and retry."
  }

  # 2. JWT_SECRET is required by docker-compose.yml (${JWT_SECRET:?set ...}).
  #    Precedence: process env -> .env file -> generate and persist to .env.
  $envFile = Join-Path $RepoRoot ".env"
  if ([string]::IsNullOrWhiteSpace($env:JWT_SECRET)) {
    if (Test-Path -LiteralPath $envFile) {
      $match = Select-String -LiteralPath $envFile -Pattern "^\s*JWT_SECRET\s*=\s*(.+)\s*$" -ErrorAction SilentlyContinue |
        Select-Object -First 1
      if ($match) {
        $env:JWT_SECRET = $match.Matches[0].Groups[1].Value.Trim().Trim('"').Trim("'")
      }
    }
  }
  if ([string]::IsNullOrWhiteSpace($env:JWT_SECRET)) {
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try {
      $bytes = New-Object byte[] 32
      $rng.GetBytes($bytes)
      $env:JWT_SECRET = [Convert]::ToBase64String($bytes)
    } finally {
      $rng.Dispose()
    }
    Add-Content -LiteralPath $envFile -Value "JWT_SECRET=$($env:JWT_SECRET)" -Encoding Ascii
    Write-Host "Generated JWT_SECRET and saved it to .env (keep this file safe; losing it invalidates sessions/tokens)."
  }

  # 3. Free requested host ports (local dev leftovers, e.g. vite/backend) before compose up.
  # System PID 4 (HTTP.sys/IIS) cannot be killed; fall back to 8080 instead.
  foreach ($p in $Ports) { Free-ListeningPort -Port $p }
  if ((Test-PortHeld -Port $HostPort) -and (-not $PSBoundParameters.ContainsKey("HostPort"))) {
    Write-Warning "Host port $HostPort is held by another program (System/IIS). Falling back to 8080."
    Write-Warning "To choose explicitly: .\start-service.ps1 -HostPort <free-port>"
    $HostPort = 8080
    Free-ListeningPort -Port $HostPort
  }
  if (Test-PortHeld -Port $HostPort) {
    throw "Host port $HostPort is already in use. Rerun with -HostPort <free-port> (e.g. -HostPort 8080)."
  }
  $env:NRG_HOST_PORT = "$HostPort"

  # 4. Start the stack.
  if ($Rebuild) {
    Write-Host "Starting stack with rebuild..."
    docker compose up -d --build
  } else {
    Write-Host "Starting stack..."
    docker compose up -d
  }
  if ($LASTEXITCODE -ne 0) { throw "docker compose up failed with exit code $LASTEXITCODE." }

  # 5. Wait for Caddy (frontend) to answer, then report status.
  $baseUrl = if ($HostPort -eq 80) { "http://localhost/" } else { "http://localhost:${HostPort}/" }
  $ready = $false
  for ($i = 1; $i -le 30; $i++) {
    try {
      $res = Invoke-WebRequest -Uri $baseUrl -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop
      if ($res.StatusCode -ge 200 -and $res.StatusCode -lt 500) { $ready = $true; break }
    } catch {
      Start-Sleep -Seconds 2
    }
  }

  Write-Host ""
  docker compose ps
  Write-Host ""
  if ($ready) {
    Write-Host "Nerovate-PM is up: $baseUrl"
    Write-Host "API base:       ${baseUrl}api/v1/"
  } else {
    Write-Host "Containers started but $baseUrl did not answer yet. Check: docker compose logs caddy frontend backend"
  }

  if ($FollowLogs) {
    docker compose logs -f
  } else {
    Write-Host "Tip: docker compose logs -f  (or rerun with -FollowLogs)"
  }
} finally {
  Pop-Location
}
