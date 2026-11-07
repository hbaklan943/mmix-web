# Compile the MMIX tools to WebAssembly with Emscripten.
# Runs ctangle with cwd=vendor (short-path requirement, see build-native.ps1),
# then emcc compiles straight out of vendor\.
# Outputs web\wasm\{mmixal.js, mmix.js} where the frontend loads them.
$ErrorActionPreference = "Stop"
$repo  = Split-Path $PSScriptRoot -Parent
$emsdk = "$env:TEMP\emsdk"
$build = Join-Path $repo "web\wasm"
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
    # "worker": the browser UI runs both tools inside a Web Worker (sim-worker.js)
    "-s", "ENVIRONMENT=web,worker,node",
    "-s", "FILESYSTEM=1",
    "-s", "ALLOW_MEMORY_GROWTH=1",
    # mmix-sim's make_map() keeps `long map[65536]` (256 KB) on the stack for
    # the -l source listing; Emscripten's default 64 KB stack overflows on it.
    "-s", "STACK_SIZE=1048576",
    "-s", "EXIT_RUNTIME=1",
    "-s", "EXPORTED_RUNTIME_METHODS=callMain,FS,HEAPU8,HEAP32",
    "-std=gnu89", "-O2"
)

emcc mmixal.c mmix-arith.c -o (Join-Path $build "mmixal.js") `
      -s EXPORT_NAME=initMmixal @common
if ($LASTEXITCODE -ne 0) { throw "emcc failed on mmixal" }

$inspect = Join-Path $repo "tools\mmix-inspect.c"
# Keep the compiler from turning constant printf() calls into fwrite(): only
# mmix-io's fwrite calls may be marked as program output.
$noPrintfOpt = @("-fno-builtin-printf", "-fno-builtin-fprintf", "-fno-builtin-puts", "-fno-builtin-fputs")
$inspectExports = '"_main","_mmix_get_g_ptr","_mmix_get_l_ptr","_mmix_get_lring_mask","_mmix_get_inst_ptr_addr","_mmix_mem_read_tetra"'

# Normal simulator (Run). --wrap=fwrite marks program output, see mmix-inspect.c
emcc mmix-sim.c mmix-arith.c mmix-io.c $inspect -o (Join-Path $build "mmix.js") `
      -s EXPORT_NAME=initMmix @common @noPrintfOpt "-Wl,--wrap=fwrite" `
      -s "EXPORTED_FUNCTIONS=[$inspectExports]"
if ($LASTEXITCODE -ne 0) { throw "emcc failed on mmix" }

# Debug simulator (step / breakpoints). Asyncify lets mmix-sim's interactive
# command read (fgets on stdin) await the UI; see tools\mmix-debug.c.
# Only the functions on that call path are instrumented, so it stays fast.
emcc mmix-sim.c mmix-arith.c mmix-io.c $inspect (Join-Path $repo "tools\mmix-debug.c") -o (Join-Path $build "mmix-debug.js") `
      -s EXPORT_NAME=initMmixDebug @common @noPrintfOpt "-Wl,--wrap=fwrite" "-Wl,--wrap=fgets" "-Wl,--wrap=printf" "-Wl,--wrap=fputc" `
      -s ASYNCIFY=1 `
      -s 'ASYNCIFY_ONLY=["mmix_debug_main","__main_argc_argv","main","__wrap_fgets"]' `
      -s "EXPORTED_FUNCTIONS=[$inspectExports,`"_mmix_debug_main`",`"_mmix_halted`",`"_mmix_line_of`",`"_mmix_bp_clear`",`"_mmix_bp_add`",`"_mmix_bp_temp`",`"_mmix_last_exec_ptr`",`"_mmix_line_map`",`"_malloc`",`"_free`"]" `
      -s "EXPORTED_RUNTIME_METHODS=callMain,FS,HEAPU8,HEAP32,HEAPU32,ccall,stringToUTF8"
if ($LASTEXITCODE -ne 0) { throw "emcc failed on mmix-debug" }
Pop-Location

Write-Host "WASM BUILD OK -> $build"
