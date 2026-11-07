# Produce a self-contained static bundle in docs\ (GitHub Pages serves /docs on master).
# docs\ is generated: edit web\ and run this script (-SkipWasm reuses web\wasm).
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
# vendor .mms examples are served from repo root in dev; mirror them into the bundle
New-Item -ItemType Directory -Force (Join-Path $docs "vendor") | Out-Null
Copy-Item (Join-Path $repo "vendor\*.mms") (Join-Path $docs "vendor") -Force
New-Item -ItemType File -Path (Join-Path $docs ".nojekyll") -Force | Out-Null
Write-Host "BUNDLE OK -> $docs (GitHub Pages: master /docs)"
