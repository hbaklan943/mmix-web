# Produce a self-contained static bundle in docs\ (GitHub Pages serves /docs on master).
param([switch]$SkipWasm)
$ErrorActionPreference = "Stop"
$repo = Split-Path $PSScriptRoot -Parent
$docs = Join-Path $repo "docs"
if (-not $SkipWasm) {
    & (Join-Path $repo "tools\build-wasm.ps1")
    if ($LASTEXITCODE -ne 0) { throw "wasm build failed" }
}
if (Test-Path $docs) { Remove-Item $docs -Recurse -Force }
Copy-Item (Join-Path $repo "web") $docs -Recurse
New-Item -ItemType File -Path (Join-Path $docs ".nojekyll") -Force | Out-Null
Write-Host "BUNDLE OK -> $docs (GitHub Pages: master /docs)"
