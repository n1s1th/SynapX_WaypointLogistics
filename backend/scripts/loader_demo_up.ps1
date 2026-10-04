<#
.SYNOPSIS
    Sets up the full loader demo on LOCAL Postgres in one command.

.DESCRIPTION
    For a fresh clone. It:

      1. checks backend/.env exists and that its DATABASE_URL (and
         DATABASE_URL_UNPOOLED, if set) point at this machine - it refuses
         anything that looks like Neon or any other remote host;
      2. runs local_db.ps1, which points this session at local Postgres, then
         checks Postgres answers and creates the database if it is missing;
      3. runs `alembic upgrade head` against that local database;
      4. runs `seed_loader_demo.py --reset` (the Figma scenario);
      5. prints how to start the backend and frontend, and who to sign in as.

    It never touches Neon: every step reads the local override that local_db.ps1
    sets, and the seed has its own local-host guard as well.

    Run it from backend/ after installing the backend (see
    docs/reference/loader/RUN_LOADER_DEMO.md):

        .\scripts\loader_demo_up.ps1

.PARAMETER Database
    Local database to create, migrate and seed. Defaults to waypoint_loader_dev.
#>
param(
    [string]$Database = "waypoint_loader_dev",
    [int]   $Port     = 5432,
    [string]$User     = "postgres",
    [string]$Password = "postgres"
)

$ErrorActionPreference = "Stop"

$backend = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $backend ".env"
$python  = Join-Path $backend ".venv\Scripts\python.exe"
$localHosts = @("localhost", "127.0.0.1", "::1")

function Step([string]$text) {
    Write-Host ""
    Write-Host "==> $text" -ForegroundColor Cyan
}

function Get-DbHost([string]$url) {
    # postgresql+psycopg2://user:pass@host:5432/db?sslmode=... -> host
    if ($url -match "@\[?([^\]:/?]+)") { return $Matches[1].ToLower() }
    if ($url -match "://\[?([^\]:/?@]+)") { return $Matches[1].ToLower() }
    return ""
}

# --- 1. backend/.env must exist and must point at this machine -----------------

Step "Checking backend/.env"
if (-not (Test-Path $envFile)) {
    throw "backend/.env is missing. Copy backend/.env.example to backend/.env (its DATABASE_URL is already localhost), then run this again."
}

$urls = @{}
foreach ($line in Get-Content $envFile) {
    if ($line -match '^\s*(DATABASE_URL|DATABASE_URL_UNPOOLED)\s*=\s*(.*)$') {
        $urls[$Matches[1]] = $Matches[2].Trim().Trim('"').Trim("'")
    }
}
if (-not $urls["DATABASE_URL"]) {
    throw "backend/.env has no DATABASE_URL. Copy it from backend/.env.example."
}
foreach ($name in @("DATABASE_URL", "DATABASE_URL_UNPOOLED")) {
    $url = $urls[$name]
    if (-not $url) { continue }
    $dbHost = Get-DbHost $url
    if ($url -match "neon" -or $localHosts -notcontains $dbHost) {
        throw "REFUSING: $name in backend/.env points at '$dbHost', which is not this machine (Neon or another remote database). This demo only runs against local Postgres. Point backend/.env at localhost (see backend/.env.example) and run it again."
    }
    Write-Host "  $name -> $dbHost (local)"
}

if (-not (Test-Path $python)) {
    throw "backend/.venv is missing. From backend/: py -3.11 -m venv .venv, then .\.venv\Scripts\python.exe -m pip install -e . (see docs/reference/loader/RUN_LOADER_DEMO.md)."
}

# --- 2. Local Postgres: point this session at it, check it answers, create the DB ----

Step "Pointing this session at local Postgres ($Database)"
. (Join-Path $PSScriptRoot "local_db.ps1") -Database $Database -Port $Port -User $User -Password $Password
if ($env:DATABASE_URL -notlike "*@localhost:$Port/$Database" -or $env:DATABASE_URL_UNPOOLED -ne $env:DATABASE_URL) {
    throw "REFUSING: local_db.ps1 did not set a local DATABASE_URL."
}

$probe = New-Object System.Net.Sockets.TcpClient
try {
    $reachable = $probe.ConnectAsync("localhost", $Port).Wait(3000)
} catch {
    $reachable = $false
} finally {
    $probe.Dispose()
}
if (-not $reachable) {
    throw "Postgres is not answering on localhost:$Port. Start it (Windows: the 'postgresql-x64-*' service; Docker: docker compose up -d database, from the repo root), then run this again."
}

$env:DEMO_PG_PORT = "$Port"
$env:DEMO_PG_USER = $User
$env:DEMO_PG_PASSWORD = $Password
$env:DEMO_PG_DATABASE = $Database
$createDb = @'
import os
import psycopg2
from psycopg2 import sql

conn = psycopg2.connect(
    host="localhost", port=int(os.environ["DEMO_PG_PORT"]), dbname="postgres",
    user=os.environ["DEMO_PG_USER"], password=os.environ["DEMO_PG_PASSWORD"],
)
conn.autocommit = True
name = os.environ["DEMO_PG_DATABASE"]
with conn.cursor() as cur:
    cur.execute("select 1 from pg_database where datname = %s", (name,))
    if cur.fetchone():
        print(f"  database {name} already exists")
    else:
        cur.execute(sql.SQL("create database {}").format(sql.Identifier(name)))
        print(f"  created database {name}")
conn.close()
'@
$createDb | & $python -
$createExit = $LASTEXITCODE
Remove-Item Env:DEMO_PG_PORT, Env:DEMO_PG_USER, Env:DEMO_PG_PASSWORD, Env:DEMO_PG_DATABASE
if ($createExit -ne 0) {
    throw "Could not create or open database '$Database' as '$User'. Check the Postgres user and password (-User / -Password)."
}

# --- 3 and 4. Migrate and seed, from backend/ (alembic.ini and .env live there) ------

Push-Location $backend
try {
    Step "alembic upgrade head (local only)"
    & $python -m alembic upgrade head
    if ($LASTEXITCODE -ne 0) { throw "alembic upgrade head failed." }

    Step "Seeding the Figma loader scenario (--reset)"
    & $python scripts\seed_loader_demo.py --reset
    if ($LASTEXITCODE -ne 0) { throw "seed_loader_demo.py --reset failed." }
} finally {
    Pop-Location
}

# --- 5. What to do next ---------------------------------------------------------------

Step "Loader demo is ready on localhost/$Database"
Write-Host @"

Next, in two terminals:

  1. Backend (from backend/):
       . .\scripts\local_db.ps1 -Database $Database
       .\.venv\Scripts\python.exe main.py

  2. Frontend (from frontend/, after npm install):
       `$env:NEXT_PUBLIC_LOADER_TRANSPORT = "api"
       npm run dev

  3. Open http://localhost:3000/loader/sign-in and sign in as
       Saman J.  -  PIN 4417

Run this script again at any time to reset the demo data.
"@
