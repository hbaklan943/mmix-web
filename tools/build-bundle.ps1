# Produce a self-contained static bundle in dist\ (web/ + wasm/ + vendored CodeMirror).
# Run tools\build-wasm.ps1 first (or pass -SkipWasm if web\wasm already built).
param([switch]$SkipWasm)
$ErrorActionPreference = "Stop"
$repo = Split-Path $PSScriptRoot -Parent
$dist = Join-Path $repo "dist"
if (-not $SkipWasm) {
    & (Join-Path $repo "tools\build-wasm.ps1")
    if ($LASTEXITCODE -ne 0) { throw "wasm build failed" }
}
if (Test-Path $dist) { Remove-Item $dist -Recurse -Force }
Copy-Item (Join-Path $repo "web") $dist -Recurse
Write-Host "BUNDLE OK -> $dist (serve with any static server)"
