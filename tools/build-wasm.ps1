# Compile MMIXing tools to WebAssembly with Emscripten.
# Copies nothing: runs ctangle with cwd=vendor (short-path requirement,
# see build-native.ps1), then emcc compiles straight out of vendor\.
# Outputs build\wasm\{mmixal.js, mmix.js} (+ .wasm next to them).
$ErrorActionPreference = "Stop"
$repo  = Split-Path $PSScriptRoot -Parent
$emsdk = "$env:TEMP\emsdk"
$build = Join-Path $repo "build\wasm"
New-Item -ItemType Directory -Force $build | Out-Null

if (-not (Test-Path "$emsdk\emsdk.bat")) { throw "emsdk not found at $emsdk" }
Push-Location $emsdk
& .\emsdk.bat activate latest | Out-Null
& .\emsdk_env.ps1 | Out-Null
Pop-Location

Push-Location $repo\vendor
Trap { Pop-Location; throw }

$ctangle = Join-Path $repo "tools\ctangle.exe"
if (-not (Test-Path $ctangle)) {
    throw "ctangle.exe missing; run tools\build-native.ps1 first"
}

Set-Content -Path empty.ch -Value "" -NoNewline
foreach ($w in "mmix-arith", "mmix-io", "mmixal", "mmix-sim", "abstime") {
    & $ctangle "$w.w" empty.ch
    if ($LASTEXITCODE -ne 0) { throw "ctangle failed on $w" }
}

# abstime.h: generated each build, consumed by mmix-sim.c at compile time
gcc -std=gnu89 -O2 -o abstime.exe abstime.c
if ($LASTEXITCODE -ne 0) { throw "gcc failed to build abstime" }
.\abstime.exe | Out-File -Encoding ascii abstime.h

$common = @(
    "-s", "MODULARIZE=1",
    "-s", "ENVIRONMENT=web,node",
    "-s", "FILESYSTEM=1",
    "-s", "ALLOW_MEMORY_GROWTH=1",
    "-s", "EXIT_RUNTIME=1",
    "-s", "EXPORTED_RUNTIME_METHODS=callMain,FS",
    "-std=gnu89", "-O2"
)

emcc mmixal.c mmix-arith.c -o (Join-Path $build "mmixal.js") `
      -s EXPORT_NAME=initMmixal @common
if ($LASTEXITCODE -ne 0) { throw "emcc failed on mmixal" }

emcc mmix-sim.c mmix-arith.c mmix-io.c -o (Join-Path $build "mmix.js") `
      -s EXPORT_NAME=initMmix @common
if ($LASTEXITCODE -ne 0) { throw "emcc failed on mmix" }
Pop-Location

Write-Host "WASM BUILD OK -> $build"
