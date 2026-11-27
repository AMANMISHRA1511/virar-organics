$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
& node scripts/dev.mjs
exit $LASTEXITCODE
