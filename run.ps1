$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $repoRoot
& node (Join-Path $repoRoot "scripts\run-pispider.mjs") @args
exit $LASTEXITCODE
