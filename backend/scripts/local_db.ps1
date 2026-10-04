<#
.SYNOPSIS
    Points this PowerShell session at the LOCAL Postgres database.

.DESCRIPTION
    backend/.env points at the SHARED Neon database. Migrations, seed scripts and
    local backend runs must never touch it (docs/reference/loader/LOADER_FEATURES.md -> Rules
    for Claude Code).

    Two variables must be overridden, not one:
      DATABASE_URL           - used by the app and the seed script
      DATABASE_URL_UNPOOLED  - preferred by alembic/env.py, which would otherwise
                               fall back to the Neon owner connection in .env

    Dot-source this script so the variables survive in your session:

        . .\scripts\local_db.ps1

.PARAMETER Database
    Local database name. Defaults to waypoint_loader_dev.
#>
param(
    [string]$Database = "waypoint_loader_dev",
    [string]$DbHost   = "localhost",
    [int]   $Port     = 5432,
    [string]$User     = "postgres",
    [string]$Password = "postgres"
)

$ErrorActionPreference = "Stop"

$forbidden = @("neon.tech", "neon.build", "aws.neon")
foreach ($needle in $forbidden) {
    if ($DbHost -like "*$needle*") {
        throw "REFUSING: '$DbHost' looks like a shared Neon host. This script is for local Postgres only."
    }
}
if ($DbHost -notin @("localhost", "127.0.0.1", "::1")) {
    throw "REFUSING: host '$DbHost' is not local. Pass -DbHost localhost, or migrate by hand if you really mean it."
}

$url = "postgresql+psycopg2://${User}:${Password}@${DbHost}:${Port}/${Database}"

$env:DATABASE_URL          = $url
$env:DATABASE_URL_UNPOOLED = $url

Write-Host "Local Postgres session configured:" -ForegroundColor Green
Write-Host "  DATABASE_URL          = postgresql+psycopg2://${User}:***@${DbHost}:${Port}/${Database}"
Write-Host "  DATABASE_URL_UNPOOLED = (same)"
Write-Host ""
Write-Host "Neon is NOT reachable from this session. Run alembic, the seed script and" -ForegroundColor DarkGray
Write-Host "'python main.py' from here." -ForegroundColor DarkGray
