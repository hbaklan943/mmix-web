/* sim-worker.js — runs mmixal and mmix (MMIXware compiled to WASM) off the
   main thread, so a program that never halts can't freeze the page: the UI
   just terminates this worker (Stop button).

   Messages in:  { id, type: "assemble" | "run" | "debug" | "cmd" |
                   "breakpoints" | "mem" | "readFile", ... }
   Messages out: { id, ok, result | error }
                 { type: "out", stream: "stdout" | "sim" | "stderr", text }
                 { type: "paused", state }   (debug sessions)
   The module from the last run/debug session is kept so the UI can read its
   memory, registers and files afterwards. */
"use strict";

importScripts("wasm/mmixal.js", "wasm/mmix.js", "wasm/mmix-debug.js");

const OUTPUT_LIMIT = 4e6; // characters kept / streamed per stream
const STDIN_FILE = ".stdin";
let simModule = null;     // module of the most recent run or debug session

// Program output arrives bracketed by SO/SI (see tools/mmix-inspect.c);
// everything else on stdout is the simulator talking.
const SO = "\x0e", SI = "\x0f";

function runTool(Init, args, files, { stream = false, extra = {}, exec = null } = {}) {
  return new Promise((resolve, reject) => {
    const out = { stdout: "", sim: "", stderr: "" };
    let truncated = false, inProgram = false;
    let pending = "", pendingStream = "stdout", lastFlush = 0;
    const flush = () => {
      if (pending) postMessage({ type: "out", stream: pendingStream, text: pending });
      pending = "";
      lastFlush = Date.now();
    };
    const emit = (s, text) => {
      if (!text) return;
      if (out[s].length >= OUTPUT_LIMIT) {
        if (!truncated) {
          truncated = true;
          const note = `[output truncated after ${OUTPUT_LIMIT / 1e6}M characters]\n`;
          out.stderr += note;
          if (stream) { flush(); postMessage({ type: "out", stream: "stderr", text: note }); }
        }
        return;
      }
      out[s] += text;
      if (!stream) return;
      if (s !== pendingStream) { flush(); pendingStream = s; }
      pending += text;
      // Batch messages: the simulator can print millions of lines.
      if (pending.length > 65536 || Date.now() - lastFlush > 40) flush();
    };
    const onStdout = (line) => {
      for (const part of (line + "\n").split(/([\x0e\x0f])/)) {
        if (part === SO) inProgram = true;
        else if (part === SI) inProgram = false;
        else if (inProgram) emit("stdout", part);
        else if (!dbg.quiet) emit("sim", part); // quiet: hidden start-up step of a debug session
      }
    };
    let M = null;
    const done = (rc) => { flush(); resolve({ ...out, rc, M }); };
    const fail = (e) => {
      if (e && typeof e.status === "number") done(e.status); // exit()
      else { flush(); reject(e); }
    };
    Init({
      noInitialRun: true,
      thisProgram: args[0],
      arguments: args.slice(1),
      locateFile: (p) => "wasm/" + p,
      // Never let Emscripten fall back to window.prompt(); stdin comes from -f.
      stdin: () => null,
      print: onStdout,
      printErr: (t) => emit("stderr", t + "\n"),
      flushOutput: flush,
      ...extra,
    }).then(async (mod) => {
      M = mod;
      try {
        for (const f of files) {
          M.FS.writeFile(f.name, f.data, f.opts);
          // Source written now would look newer than the .mmo, and mmix-sim
          // would warn "File ... was modified" when listing it.
          if (f.old) M.FS.utime(f.name, 0, 0);
        }
        done(exec ? await exec(M) : M.callMain(args.slice(1)));
      } catch (e) {
        fail(e);
      }
    }, reject);
  });
}

// MMIXware octa = { tetra h, l }: high word first.
function octaAt(view, p) {
  return ((BigInt(view.getUint32(p, true)) << 32n) | BigInt(view.getUint32(p + 4, true))).toString(16);
}

// Register snapshot as hex strings (see tools/mmix-inspect.c for the layout).
function snapshotRegs(M) {
  const view = new DataView(M.HEAPU8.buffer);
  const gPtr = M._mmix_get_g_ptr();
  const g = [];
  for (let i = 0; i < 256; i++) g.push(octaAt(view, gPtr + i * 8));
  const rO = 10, rG = 19, rL = 20; // special_reg enum indices
  const G = parseInt(g[rG], 16) & 0xff;
  const L = parseInt(g[rL], 16) & 0xff;
  const lPtr = M._mmix_get_l_ptr(), mask = M._mmix_get_lring_mask();
  const O = Number((BigInt("0x" + g[rO]) >> 3n) & 0xffffffffn);
  const locals = [];
  for (let k = 0; k < Math.min(L, G); k++) locals.push(octaAt(view, lPtr + ((O + k) & mask) * 8));
  return { ip: octaAt(view, M._mmix_get_inst_ptr_addr()), g, locals };
}

function listFiles(M, skip) {
  const files = [];
  let names = [];
  try { names = M.FS.readdir("/"); } catch (e) { /* none */ }
  for (const n of names) {
    if ([".", "..", "dev", "proc", "tmp", "home"].includes(n) || skip.includes(n)) continue;
    try {
      const st = M.FS.stat("/" + n);
      if (M.FS.isFile(st.mode)) files.push({ name: n, size: st.size });
    } catch (e) { /* skip */ }
  }
  return files;
}

function programFiles({ stem, mmo, src, stdin, uploads }) {
  return [
    { name: stem + ".mmo", data: mmo },
    { name: stem + ".mms", data: src || "", opts: { encoding: "utf8" }, old: true }, // for -l source listing
    // stdin goes through -f<file>: with a real file, end of input reaches the
    // program as EOF (Fgets returns -1) instead of a simulator panic.
    { name: STDIN_FILE, data: stdin || "", opts: { encoding: "utf8" } },
    ...uploads,
  ];
}

function finish(r, req) {
  simModule = r.M;
  const skip = [req.stem + ".mmo", req.stem + ".mms", STDIN_FILE, ...req.uploads.map((u) => u.name)];
  return { rc: r.rc, stdout: r.stdout, stderr: r.stderr, regs: snapshotRegs(r.M), files: listFiles(r.M, skip) };
}

/* ---------- debug sessions ---------- */
// mmix-sim runs with -i; every time it wants a command it calls
// Module.mmixWaitCommand() (tools/mmix-debug.c), which resolves when the UI
// sends one. Commands: "n" one instruction, "C" continue until a breakpoint
// instruction has run (checked in mmix-debug.c), "q" quit.
const dbg = {
  M: null,
  resume: null,         // resolves the pending mmixWaitCommand()
  booted: false,        // the hidden start-up instruction has been stepped
  lineAddr: new Map(),  // source line -> first address assembled from it
  bpCount: 0,           // number of resolved user breakpoints
};

const hexToHL = (hex) => {
  const a = BigInt("0x" + hex);
  return [Number(a >> 32n), Number(a & 0xffffffffn)];
};

function buildLineMap(M) {
  const max = 1 << 16;
  const buf = M._malloc(max * 12);
  const n = M._mmix_line_map(buf, max);
  const t = M.HEAPU32.subarray(buf >> 2, (buf >> 2) + 3 * n);
  dbg.lineAddr.clear();
  for (let i = 0; i < n; i++) {
    const line = t[3 * i + 2];
    const addr = ((BigInt(t[3 * i]) << 32n) | BigInt(t[3 * i + 1])).toString(16);
    if (!dbg.lineAddr.has(line)) dbg.lineAddr.set(line, addr); // tree walk is in address order
  }
  M._free(buf);
}

function applyBreakpoints(lines) {
  const resolved = [];
  dbg.M._mmix_bp_clear();
  for (const line of lines) {
    const a = dbg.lineAddr.get(line);
    if (a) { dbg.M._mmix_bp_add(...hexToHL(a)); resolved.push(line); }
  }
  dbg.bpCount = resolved.length;
  return resolved;
}

// Called by mmix-debug.c every POLL_EVERY instructions while continuing.
async function mmixPollBreak() {
  if (dbg.M && dbg.M.flushOutput) dbg.M.flushOutput();
  await new Promise((r) => setTimeout(r, 0)); // let queued messages (Break) run
  return dbg.breakReq;
}

function mmixWaitCommand() {
  const M = dbg.M;
  if (!dbg.booted) {
    // mmix-sim stops before the hidden start-up UNSAVE at #fc; step over it
    // so the session starts at the program's first instruction.
    dbg.booted = true;
    buildLineMap(M);
    applyBreakpoints(dbg.initialLines);
    dbg.quiet = true;
    return Promise.resolve("n\n");
  }
  dbg.quiet = false;
  // After a halt mmix-sim asks once more; let it finish so the run completes.
  if (M._mmix_halted()) return Promise.resolve("q\n");
  if (M.flushOutput) M.flushOutput();
  const regs = snapshotRegs(M);
  const [h, l] = hexToHL(regs.ip);
  postMessage({
    type: "paused",
    state: {
      regs,
      line: M._mmix_line_of(h, l),        // next instruction
      inst: (M._mmix_mem_read_tetra(h, l) >>> 0).toString(16).padStart(8, "0"),
      // the instruction executed last (what MMIXVD's arrow marks); 0 = none yet
      lastLine: !dbg.stepped ? 0 : dbg.markAddr ? M._mmix_line_of(...hexToHL(dbg.markAddr)) : (() => {
        const p = M._mmix_last_exec_ptr() >> 2;
        const lh = M.HEAPU32[p], ll = M.HEAPU32[p + 1];
        return lh === 0 && ll < 0x100 ? 0 : M._mmix_line_of(lh, ll); // #fc start-up code has no line
      })(),
    },
  });
  dbg.markAddr = null;
  return new Promise((res) => { dbg.resume = res; });
}

const handlers = {
  async assemble({ src, stem }) {
    const r = await runTool(initMmixal, ["mmixal", "-x", "-b", "250", "-l", stem + ".lst", stem + ".mms"],
      [{ name: stem + ".mms", data: src, opts: { encoding: "utf8" } }]);
    const read = (n, enc) => { try { return r.M.FS.readFile(n, enc ? { encoding: enc } : undefined); } catch (e) { return null; } };
    return { stdout: r.sim + r.stdout, stderr: r.stderr, mmo: read(stem + ".mmo"), listing: read(stem + ".lst", "utf8") };
  },

  async run(req) {
    simModule = null;
    const args = ["mmix", ...req.flags, "-f" + STDIN_FILE, req.stem];
    return finish(await runTool(initMmix, args, programFiles(req), { stream: true }), req);
  },

  async debug(req) {
    simModule = null;
    Object.assign(dbg, { M: null, resume: null, booted: false, quiet: false, bpCount: 0, stepped: false, markAddr: null,
      initialLines: req.breakpoints || [] });
    const args = ["-i", "-f" + STDIN_FILE, req.stem];
    const r = await runTool(initMmixDebug, ["mmix", ...args], programFiles(req), {
      stream: true,
      extra: { mmixWaitCommand, mmixPollBreak },
      exec: (M) => {
        dbg.M = M;
        simModule = M; // memory reads while paused
        return M.ccall("mmix_debug_main", "number", ["string"], [args.join("\n")], { async: true });
      },
    });
    dbg.M = null;
    return finish(r, req);
  },

  // Resume a paused debug session: text is "n" (step) or "C" (continue);
  // tempAddr (hex) is a one-shot breakpoint for step over / out / run to cursor.
  // tempMode: 1 = stop before executing tempAddr, 2 = stop after executing it.
  cmd({ text, tempAddr, tempMode, markAddr }) {
    if (!dbg.resume) return false;
    dbg.stepped = true; // from now on the program has executed something
    dbg.markAddr = markAddr || null;
    if (tempAddr) dbg.M._mmix_bp_temp(...hexToHL(tempAddr), tempMode || 1);
    // Always "C" (never mmix-sim's own "c"): it polls for Break.
    dbg.breakReq = false;
    const r = dbg.resume;
    dbg.resume = null;
    r(text + "\n");
    return true;
  },

  // Pause a continuing debug session at the next poll (Break button).
  breakExec() {
    dbg.breakReq = true;
    return true;
  },

  breakpoints({ lines }) {
    if (!dbg.M) return null;
    return applyBreakpoints(lines);
  },

  addrOfLine({ line }) {
    return dbg.lineAddr.get(line) || null;
  },

  // Read `count` bytes starting at `addr` (hex string, tetra aligned).
  mem({ addr, count }) {
    const bytes = new Uint8Array(count);
    if (!simModule) return null;
    let a = BigInt("0x" + addr);
    for (let i = 0; i < count; i += 4, a += 4n) {
      const v = simModule._mmix_mem_read_tetra(Number((a >> 32n) & 0xffffffffn), Number(a & 0xffffffffn)) >>> 0;
      bytes[i] = v >>> 24; bytes[i + 1] = (v >>> 16) & 0xff; bytes[i + 2] = (v >>> 8) & 0xff; bytes[i + 3] = v & 0xff;
    }
    return bytes;
  },

  readFile({ name }) {
    return simModule ? simModule.FS.readFile("/" + name) : null;
  },
};

onmessage = async (e) => {
  const { id, type } = e.data;
  try {
    const result = await handlers[type](e.data);
    postMessage({ id, ok: true, result });
  } catch (err) {
    postMessage({ id, ok: false, error: String((err && err.message) || err) });
  }
};
postMessage({ type: "ready" });
