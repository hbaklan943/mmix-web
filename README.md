# mmix-web

An in-browser MMIX IDE: write MMIXAL in the editor, assemble it, simulate the
resulting `.mmo`, and watch the machine run — all client-side, powered by
WebAssembly builds of Donald Knuth's [MMIXware](https://mmix.cs.hm.edu/).

## Architecture

```
vendor/     Knuth's CWEB sources (mmixal.w, mmix-sim.w, mmix-arith.w, ...)
tools/      build scripts + bootstrap ctangle (from cweb)
build/      generated artifacts (not committed)
  native/   native mmixal.exe + mmix.exe (Windows dev build)
  wasm/     mmixal.js + mmix.js + .wasm (for the browser)
web/        the frontend: editor, assembler, simulator UI
```

The chain is: `.mms` → (mmixal.wasm) → `.mmo` → (mmix-sim.wasm) → stdout/trace.
Both tools are the unmodified CWEB originals, compiled to WASM; the web layer
just feeds files into Emscripten's virtual FS and reads the outputs.

## Building

Prerequisites: MinGW gcc (PATH), Node.js, git.

```powershell
# native dev build
powershell -File tools\build-native.ps1

# wasm build (needs emsdk; see tools\build-wasm.ps1)
powershell -File tools\build-wasm.ps1
```

## Run (native parity test)

```powershell
build\native\mmixal.exe vendor\hello.mms
build\native\mmix.exe hello
# -> hello, world
```

## Live\n\n- GitHub Pages: https://hbaklan943.github.io/mmix-web/\n- Vercel: https://docs-psi-fawn.vercel.app/\n\n## Status

- [x] Bootstrap ctangle from cweb, tangle MMIXware to C
- [x] Native mmixal + mmix build (Windows/MinGW), hello.mms parity test
- [ ] Emscripten builds of mmixal and mmix-sim (mmixal.js, mmix.js)
- [ ] Web frontend: editor, assemble, run, I/O console
- [ ] Trace view, register/memory inspector
