# Build the MMIX toolchain natively from the vendored CWEB sources.
#   ctangle.exe (bootstrapped from cweb) tangles the .w files into C,
#   then MinGW gcc compiles mmixal and the mmix simulator.
# ctangle has fixed-size filename buffers, so it runs with cwd=vendor
# and short relative paths, exactly like the upstream Makefile.
$ErrorActionPreference = "Stop"
$repo  = Split-Path $PSScriptRoot -Parent
$build = Join-Path $repo "build\native"
New-Item -ItemType Directory -Force $build | Out-Null

# 1) Bootstrap ctangle from cweb (only needed once)
$ctangle = Join-Path $repo "tools\ctangle.exe"
if (-not (Test-Path $ctangle)) {
    gcc -O2 -o $ctangle `
        (Join-Path $repo "tools\ctangle.c") `
        (Join-Path $repo "tools\common.c") | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "gcc failed to build ctangle" }
    Write-Host "bootstrapped ctangle.exe"
}

Push-Location $repo\vendor
Trap { Pop-Location; throw }

# 2) CWEB needs a change file; MMIXware uses none, so give it an empty one
Set-Content -Path empty.ch -Value "" -NoNewline

foreach ($w in "mmix-arith", "mmix-io", "mmixal", "mmix-sim", "abstime") {
    & $ctangle "$w.w" empty.ch
    if ($LASTEXITCODE -ne 0) { throw "ctangle failed on $w" }
}

# 3) abstime generates the timestamp header mmix-sim wants at compile time
gcc -std=gnu89 -O2 -o abstime.exe abstime.c
if ($LASTEXITCODE -ne 0) { throw "gcc failed to build abstime" }
.\abstime.exe | Out-File -Encoding ascii abstime.h

# 4) The actual tools
gcc -std=gnu89 -O2 -o (Join-Path $build "mmixal.exe") mmixal.c mmix-arith.c
if ($LASTEXITCODE -ne 0) { throw "gcc failed to build mmixal" }
gcc -std=gnu89 -O2 -o (Join-Path $build "mmix.exe") mmix-sim.c mmix-arith.c mmix-io.c
if ($LASTEXITCODE -ne 0) { throw "gcc failed to build mmix" }
Pop-Location

Write-Host "BUILD OK -> $build"
