param([switch]$StopServices)
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
& node scripts/stop.mjs
if ($LASTEXITCODE -ne 0) { throw 'Could not stop the tracked project process. Use Ctrl+C in its terminal.' }
if ($StopServices) { & docker compose stop; if ($LASTEXITCODE -ne 0) { throw 'Docker services did not stop.' } }
