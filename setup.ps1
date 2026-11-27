param([switch]$SkipDocker)
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Install Node.js 24 LTS, reopen VS Code, and try again.' }
if ($SkipDocker) { & node scripts/setup.mjs --skip-docker } else { & node scripts/setup.mjs }
if ($LASTEXITCODE -ne 0) { throw 'Setup failed. Read the error above and README.md.' }
