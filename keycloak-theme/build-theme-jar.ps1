# ==============================================================================
# Waypoint Logistics - Keycloak Theme JAR Packaging Script (PowerShell)
# Builds waypoint-theme.jar for Keycloak /opt/keycloak/providers/
# ==============================================================================

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$sourceDir = Join-Path $scriptDir "waypoint"
$outputJar = Join-Path $scriptDir "waypoint-theme.jar"
$tempDir = Join-Path $scriptDir "temp_jar_build"

Write-Host "Building Waypoint Keycloak Theme JAR..." -ForegroundColor Cyan

if (Test-Path $tempDir) {
    Remove-Item -Recurse -Force $tempDir
}
if (Test-Path $outputJar) {
    Remove-Item -Force $outputJar
}

# Create staging structure
$metaInfDir = Join-Path $tempDir "META-INF"
$themeDestDir = Join-Path $tempDir "theme\waypoint"

New-Item -ItemType Directory -Path $metaInfDir -Force | Out-Null
New-Item -ItemType Directory -Path $themeDestDir -Force | Out-Null

# Write META-INF/keycloak-themes.json
$themeJson = @{
    themes = @(
        @{
            name = "waypoint"
            types = @("login")
        }
    )
} | ConvertTo-Json -Depth 5

$themeJson | Out-File -FilePath (Join-Path $metaInfDir "keycloak-themes.json") -Encoding utf8 -NoNewline

# Copy theme files to staging
Copy-Item -Recurse -Path (Join-Path $sourceDir "*") -Destination $themeDestDir

# Create Zip Archive with standard forward slashes (Linux/Java compatible)
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$zipStream = [System.IO.File]::Create($outputJar)
$archive = New-Object System.IO.Compression.ZipArchive($zipStream, [System.IO.Compression.ZipArchiveMode]::Create)

$files = Get-ChildItem -Path $tempDir -Recurse -File
foreach ($file in $files) {
    $relativePath = $file.FullName.Substring($tempDir.Length + 1).Replace('\', '/')
    $entry = $archive.CreateEntry($relativePath, [System.IO.Compression.CompressionLevel]::Optimal)
    $entryStream = $entry.Open()
    $fileStream = [System.IO.File]::OpenRead($file.FullName)
    $fileStream.CopyTo($entryStream)
    $fileStream.Close()
    $entryStream.Close()
}

$archive.Dispose()
$zipStream.Close()

# Cleanup staging directory
Remove-Item -Recurse -Force $tempDir

Write-Host "Success! Created: $outputJar (with Linux/JAR compliant forward slashes)" -ForegroundColor Green
Write-Host "You can now drop waypoint-theme.jar directly into Keycloak's /opt/keycloak/providers/ directory." -ForegroundColor Yellow
