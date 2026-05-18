# Build-Deployer-v1.0.1.ps1
# Version 1.0.8 (2026-04-24)
# Деплоит билд
#
# Usage:
#   .\Build-Deployer-v1.0.1.ps1

$ScriptVersion = "1.0.8"
$ErrorActionPreference = "Stop"

if ($PSScriptRoot) {
    $scriptDir = $PSScriptRoot
} elseif ($MyInvocation.MyCommand.Path) {
    $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
} else {
    $scriptDir = Get-Location
}

# Default values
$ProjectName = "plinkomdb"
$SourceDir = "build\super-html"

# Load configuration from text file
$configFile = Join-Path $scriptDir "Build-Deployer-config.txt"
if (Test-Path $configFile) {
    $config = Get-Content $configFile -Encoding UTF8 | Where-Object { $_ -notmatch '^\s*#' -and $_ -notmatch '^\s*$' }
    foreach ($line in $config) {
        if ($line -match '^\s*(\w+)\s*=\s*(.+)$') {
            $key = $matches[1]
            $value = $matches[2]
            switch ($key) {
                "ProjectName" { $ProjectName = $value }
                "SourceDir" { $SourceDir = $value }
            }
        }
    }
}

# Source path (relative to project root)
$projectRoot = Split-Path $scriptDir
$sourcePath = Join-Path $projectRoot $SourceDir

Write-Host ""
Write-Host "Build Deployer v$ScriptVersion" -ForegroundColor Cyan
Write-Host "Project: $ProjectName" -ForegroundColor White
Write-Host "Source:  $sourcePath" -ForegroundColor White
Write-Host "Deploy:  $scriptDir" -ForegroundColor White
Write-Host ""

# Copy ironsource2025 → index.html в папку скрипта
Write-Host "Processing ironsource2025..." -ForegroundColor Cyan
$ironsource2025Path = Join-Path $sourcePath "ironsource2025"
if (Test-Path $ironsource2025Path) {
    $indexFile = Get-ChildItem -Path $ironsource2025Path -Filter "*.html" | Select-Object -First 1
    if ($indexFile) {
        $indexPath = Join-Path $scriptDir "index.html"
        if (Test-Path $indexPath) {
            Remove-Item $indexPath -Force
        }
        Copy-Item $indexFile.FullName $indexPath -Force
        Write-Host "Copied $($indexFile.Name) → index.html" -ForegroundColor Green
    } else {
        Write-Host "No HTML file in ironsource2025" -ForegroundColor Yellow
    }
} else {
    Write-Host "ironsource2025 folder not found" -ForegroundColor Yellow
}

# Execute plbx deploy
Write-Host ""
Write-Host "Executing plbx deploy..." -ForegroundColor Cyan
$deployCommand = "plbx deploy --prod -p $ProjectName -n c1"
Write-Host "Command: $deployCommand"
try {
    Invoke-Expression $deployCommand
    Write-Host "Done!" -ForegroundColor Green
} catch {
    Write-Host "Warning: $_" -ForegroundColor Yellow
}
Write-Host ""
