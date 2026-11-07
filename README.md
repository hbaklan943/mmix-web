# mmix-web

An in-browser MMIX IDE: write MMIXAL in the editor, assemble it, simulate the
resulting `.mmo`, and watch the machine run — all client-side, powered by
WebAssembly builds of Donald Knuth's [MMIXware](https://mmix.cs.hm.edu/).
The look and the register/memory views are inspired by the MMIX Visual
Debugger (MMIXVD).

## Live

- GitHub Pages: https://hbaklan943.github.io/mmix-web/
- Vercel: https://mmix-web.vercel.app/

## Features

**Editing**
- MMIXAL syntax highlighting, column tab stops (Tab / Shift+Tab jump between
  the label, opcode, operand and comment columns).
- **A− / A+** next to Format change the editor font size (remembered).
- **Format** (Shift+Alt+F) lines the code up: labels, instructions,
  operands and comments in their columns. Ctrl+Z undoes it.
- **Open…** (Ctrl+O) opens a `.mms` file from your computer in a new tab
  (in Chrome/Edge, Ctrl+S then saves back to that same file). Dragging a
  file onto the editor works too.
- Multiple files in tabs.
- 50 example programs from MMIXware in the toolbar menu. Opening one never
  overwrites a file you have edited — it opens in a new tab instead.
- **Ctrl+S saves the current file to your computer.** In Chrome and Edge this
  opens a real *Save as* dialog the first time and then keeps saving to the same
  file; **Ctrl+Shift+S** always asks for a new location. Other browsers
  download the file.
- **Your session is remembered.** Open files, the active tab, program input,
  the Trace/Profile/Stats/Auto-run options, register and memory view settings,
  the panel layout and the theme are stored in the browser (`localStorage`)
  and come back after a reload.

**Running**
- Assemble (Ctrl+Enter) and Run (F5 or Ctrl+Shift+Enter). Run assembles first
  whenever the source changed since the last assemble.
- Assembler messages with error markers in the editor gutter.
- Output streams in live while the program runs.
- Programs run in a Web Worker, so an infinite loop never freezes the page:
  **Stop** (Shift+F5) ends the run immediately. Auto-run stops itself after
  3 seconds.
- Program input (stdin) panel; the program sees a proper end-of-file when the
  input runs out.
- Toolbar switches for the simulator's reports:
  - **Trace** (`mmix -t`): prints every executed instruction with its effect,
    interleaved with the source lines.
  - **Profile** (`mmix -P`): after the run, shows how often each instruction
    was executed — good for finding the hot loop.
  - **Stats** (`mmix -s`): instruction count, memory accesses and the
    simulated time ("oops") at the end.
  - **Auto-run**: assembles and runs a moment after you stop typing.

  Simulator messages are dimmed so the program's own output stands out.
- Files panel: *data* files for the program (it opens them with
  `TRAP 0,Fopen,…`) and downloads of files it wrote. A `.mms` uploaded
  there opens in the editor instead.
- Download the `.mmo` object file and the `.lst` listing.
- Share: copies a link that contains the program.

**Debugging** (step through the program like in MMIXVD)
- **Debug** starts a session by executing the first instruction, as MMIXVD
  does. A red arrow marks the instruction that was executed last, and
  registers and memory show the state right after it.
- **Step** (F11 or F7) executes one instruction, **Over** (F10) runs a
  `PUSHJ`/`PUSHGO` call as one step, **Out** (Shift+F11) runs until the
  current subroutine returns, **Continue** (F8, or F5 while debugging) runs to
  the next breakpoint, **Break** (F6) pauses a running program (even an
  endless loop), **Stop** (Shift+F5) ends the session.
- Breakpoints: click left of a line number or press F9. Like MMIXVD (and
  mmix-sim's own interactive mode), execution stops right *after* the
  breakpoint line ran. They are listed in the Breakpoints panel and saved
  with the file. Ctrl+F10 runs to (and including) the cursor line.
- At every stop the register panels and the memory viewer show the current
  state; the parts of a register changed by the last step are highlighted
  (just the changed wyde in WYDE view, and so on).
- Built on mmix-sim's own interactive mode (`-i`): a debug build of the
  simulator uses Emscripten's Asyncify so its command prompt can wait for the
  UI (see `tools/mmix-debug.c`).

**Inspecting (after a run or at a breakpoint)**
- Local (`$0…$rL−1`), Global (`$rG…$255`) and Special register panels, each
  with its own number system (Hex, Dec, ±Dec, Float, ASCII) and unit size
  (OCTA, TETRA, WYDE, BYTE). Registers that changed since the previous run or
  step are highlighted.
- Memory viewer with Hex+ASCII, ASCII and OCTA views, segment shortcuts
  (Text, Data, Pool, Stack) and paging. *Go to* also accepts labels from
  your program (e.g. `Msg`).
- Symbols panel: the assembler's symbol table; click a label to find it in
  the source and in memory.

**Help**
- **?** (F1) opens a Help panel: getting started, debugging, the memory
  segments, a searchable reference of all MMIX instructions and assembler
  directives, TRAP calls and special registers.
- Hover over an instruction in the editor to see what it does.

**Layout**
- Every panel is a draggable tab: drop it on another panel to group them as
  tabs, or on an edge to split. Drag the gaps between panels to resize.
- The **View** menu shows hidden panels again and resets the layout.
- Light (classic, MMIXVD-style) and dark themes.

## Keyboard shortcuts

| Keys | Action |
| --- | --- |
| Ctrl+O | Open file |
| Ctrl+S | Save file |
| Ctrl+Shift+S | Save file as… |
| Ctrl+Enter | Assemble |
| F5 / Ctrl+Shift+Enter | Run (Continue while debugging) |
| Shift+F5 | Stop |
| F11 or F7 | Debug: step one instruction |
| F10 | Debug: step over a subroutine call |
| Shift+F11 | Debug: step out of the subroutine |
| F8 | Debug: continue to the next breakpoint |
| F6 | Debug: break (pause the running program) |
| F9 | Toggle breakpoint on the cursor line |
| Ctrl+F10 | Debug: run to the cursor line |
| Tab / Shift+Tab | Next / previous MMIXAL column |
| Shift+Alt+F | Format the code |
| Ctrl + / Ctrl − / Ctrl 0 | Editor font larger / smaller / default (while the editor has focus) |
| F1 | Help |

## Architecture

```
vendor/     Knuth's CWEB sources (mmixal.w, mmix-sim.w, mmix-arith.w, ...)
tools/      build scripts, bootstrap ctangle (from cweb), tests,
            mmix-inspect.c (register/memory access), mmix-debug.c (debugger)
build/      generated artifacts (not committed)
  native/   native mmixal.exe + mmix.exe (Windows dev build)
web/        the frontend source
  app.js         editor, assemble/run, registers, memory, session
  dock.js        drag-and-drop panel layout
  sim-worker.js  Web Worker that runs mmixal + mmix
  help.js        Help panel content and instruction hover tips
  wasm/          mmixal, mmix and mmix-debug (.js + .wasm, from tools\build-wasm.ps1)
docs/       deployable copy of web/ (GitHub Pages and Vercel serve this)
```

The chain is: `.mms` → (mmixal.wasm) → `.mmo` → (mmix-sim.wasm) → stdout/trace.
Both tools are the unmodified CWEB originals, compiled to WASM; the web layer
feeds files into Emscripten's virtual FS and reads the outputs.
`tools/mmix-inspect.c` adds a few exported helpers so the UI can read the
simulator's registers (`g[]`, the local register ring `l[]`) and memory.

## Building

Prerequisites: MinGW gcc (PATH), Node.js, git, emsdk (for the WASM build).

```powershell
# native dev build
powershell -File tools\build-native.ps1

# wasm build (needs emsdk; see tools\build-wasm.ps1) -> web\wasm
powershell -File tools\build-wasm.ps1

# copy web\ into docs\ for deployment (rebuilds wasm unless -SkipWasm)
powershell -File tools\build-bundle.ps1
```

## Running locally

```powershell
npm run serve          # http://localhost:8080/web/  (or /docs/)
npm run test:e2e       # headless browser test (needs the server running)
```

## Native parity test

```powershell
build\native\mmixal.exe vendor\hello.mms
build\native\mmix.exe hello
# -> hello, world
```
