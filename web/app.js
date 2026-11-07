/* mmix-web frontend. Drives unmodified MMIXware compiled to WASM:
   .mms --mmixal--> .mmo --mmix-sim--> stdout. */
"use strict";

const $ = (id) => document.getElementById(id);

const EXAMPLES = ["stdin-demo.mms", "hello.mms", "fib.mms", "primes.mms", "sort.mms", "inout.mms", "echo.mms"];
const SPECIAL_NAMES = {
  229: "rTT", 230: "rZ", 231: "rY", 232: "rX", 233: "rW", 234: "rV",
  235: "rU", 236: "rT", 237: "rS", 238: "rR", 239: "rQ", 240: "rP",
  241: "rO", 242: "rN", 243: "rL", 244: "rK", 245: "rI", 246: "rH",
  247: "rG", 248: "rF", 249: "rE", 250: "rD", 251: "rC", 252: "rB",
  253: "rA", 254: "rJ", 255: "rBB",
};

let MMIXAL = null; // initMmixal constructor from wasm/mmixal.js
let MMIX = null;   // initMmix constructor from wasm/mmix.js
let currentMmo = null;
let currentStem = "prog"; // file stem: example name or "prog" for ad-hoc edits
let lastModule = null;

/* ---------- output panes ---------- */
function appendTo(el, chunk, cls) {
  if (chunk == null) return;
  if (el.__cls !== cls) {
    el.textContent = "";
    el.className = "console" + (cls ? " " + cls : "");
    el.__cls = cls;
  }
  el.textContent += chunk;
  el.scrollTop = el.scrollHeight;
}
function status(text, isError) {
  const el = $("status");
  el.textContent = text;
  el.classList.toggle("error", !!isError);
}

/* ---------- wasm module driver ---------- */
/* Runs one tool pristine each time. files: [{name, data, opts}].
   Returns { stdout, stderr, rc, FS } */
function runTool(Init, args, files, onOut, stdinText) {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const stdinBytes = stdinText ? new TextEncoder().encode(stdinText) : null;
    let stdinPos = 0;
    Init({
      noInitialRun: true,
      thisProgram: args[0],
      arguments: args.slice(1),
      stdin: stdinBytes
        ? () => (stdinPos < stdinBytes.length ? stdinBytes[stdinPos++] : null)
        : undefined,
      print: (t) => { stdout += t + "\n"; if (onOut) onOut(t + "\n"); },
      printErr: (t) => { stderr += t + "\n"; },
      onAbort: (what) => reject(new Error(what ? String(what) : "abort")),
    }).then((M) => {
      try {
        for (const f of files) M.FS.writeFile(f.name, f.data, f.opts);
        const rc = M.callMain(args.slice(1));
        resolve({ stdout, stderr, rc, FS: M.FS, module: M });
      } catch (e) {
        if (e && typeof e.status === "number") {
          // normal nonzero exit (e.g. mmixal reporting errors)
          resolve({ stdout, stderr, rc: e.status, FS: M.FS, module: M });
        } else {
          reject(e);
        }
      }
    }, reject);
  });
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error("failed to load " + src));
    document.body.appendChild(s);
  });
}

/* ---------- assemble / run ---------- */
async function assemble() {
  const src = $("editor").value;
  const stem = currentStem;
  const asmOut = $("asm-output");
  $("btn-run").disabled = true;
  currentMmo = null;
  asmOut.textContent = "";
  asmOut.className = "console";
  asmOut.__cls = "";
  status("assembling…");
  try {
    const { stdout, stderr, FS } = await runTool(MMIXAL, ["mmixal", "-x", "-b", "250", stem + ".mms"], [
      { name: stem + ".mms", data: src, opts: { encoding: "utf8" } },
    ], null, $("stdin").value);
    appendTo(asmOut, stderr + stdout, stderr.trim() ? "err" : "");
    let mmo = null;
    try {
      mmo = FS.readFile(stem + ".mmo");
    } catch (e) { /* assembler errors: no output */ }
    if (mmo) {
      currentMmo = mmo;
      $("btn-run").disabled = !MMIX;
      status(`assembled ${mmo.length} bytes — Ready`);
    } else {
      status("assembler error", true);
    }
  } catch (e) {
    appendTo(asmOut, String(e), "err");
    status("assembler crashed", true);
  }
}

async function run() {
  if (!currentMmo) return;
  const stem = currentStem;
  const simOut = $("sim-output");
  simOut.textContent = "";
  simOut.className = "console";
  simOut.__cls = "";
  status("running…");
  $("btn-run").disabled = true;
  try {
    const trace = $("opt-trace").checked;
    const profile = $("opt-profile").checked;
    const stats = $("opt-stats").checked;
    const args = ["mmix"];
    if (!trace && !profile && !stats) args.push("-q");
    if (trace) { args.push("-t", "1000000", "-l", "5"); }
    if (profile) args.push("-P");
    if (stats) args.push("-s");
    args.push(stem);
    const { stdout, stderr, module: M } = await runTool(MMIX, args, [
      { name: stem + ".mmo", data: currentMmo },
    ], null, $("stdin").value);
    appendTo(simOut, stdout, "");
    if (stderr.trim()) appendTo(simOut, stderr, "err");
    if (M) populateRegisters(M);
    status("done");
  } catch (e) {
    appendTo(simOut, String(e), "err");
    status("simulation aborted", true);
  } finally {
    $("btn-run").disabled = false;
  }
}

/* ---------- boot ---------- */
async function boot() {
  const exSel = $("examples");
  for (const name of EXAMPLES) {
    const opt = document.createElement("option");
    opt.textContent = name;
    opt.value = name;
    exSel.appendChild(opt);
  }
  exSel.onchange = () => loadExample(exSel.value);
  $("btn-assemble").onclick = assemble;
  $("btn-run").onclick = run;
  $("btn-mem").onclick = () => {
    if (!lastModule) return;
    try {
      const a = BigInt($("mem-addr").value.trim());
      const tet = lastModule._mmix_mem_read_tetra(Number((a >> 32n) & 0xffffffffn), Number(a & 0xffffffffn));
      $("mem-result").textContent = "0x" + tet.toString(16).padStart(8, "0");
    } catch (e) {
      $("mem-result").textContent = "bad address";
    }
  };

  const editor = $("editor");
  editor.addEventListener("keydown", (e) => {
    if (e.key === "Tab") {
      e.preventDefault();
      const start = editor.selectionStart;
      editor.setRangeText("  ", start, editor.selectionEnd, "end");
    }
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      assemble();
    }
  });

  editor.value = "";
  status("loading toolchain…");
  try {
    await loadScript("wasm/mmixal.js");
    await loadScript("wasm/mmix.js");
    MMIXAL = window.initMmixal;
    MMIX = window.initMmix;
  } catch (e) {
    status(String(e), true);
    editor.removeAttribute("placeholder");
    return;
  }
  $("btn-assemble").disabled = false;
  status("toolchain ready");
  await loadExample("hello.mms");
}

function populateRegisters(M) {
  lastModule = M;
  const ptr = M._mmix_get_g_ptr();
  const view = new DataView(M.HEAPU8.buffer);
  const ipPtr = M._mmix_get_inst_ptr_addr();
  const ipLo = view.getUint32(ipPtr, true);
  const ipHi = view.getUint32(ipPtr + 4, true);
  const lines = [];
  lines.push("inst_ptr = 0x" + ipHi.toString(16).padStart(8, "0") + ipLo.toString(16).padStart(8, "0"));
  lines.push("");
  for (let i = 255; i >= 0; i--) {
    const off = ptr + i * 8;
    const lo = view.getUint32(off, true);
    const hi = view.getUint32(off + 4, true);
    const name = SPECIAL_NAMES[i] ? "  " + SPECIAL_NAMES[i] : "   $" + i;
    lines.push(name.padEnd(8) + " = 0x" + hi.toString(16).padStart(8, "0") + lo.toString(16).padStart(8, "0"));
  }
  $("reg-output").textContent = lines.join("\n");
  $("btn-mem").disabled = false;
}

function hex64(h, l) {
  return h.toString(16).padStart(8, "0") + l.toString(16).padStart(8, "0");
}

async function loadExample(name) {
  for (const dir of ["examples", "../vendor"]) {
    try {
      const res = await fetch(dir + "/" + name);
      if (!res.ok) continue;
      currentStem = name.replace(/\.mms$/, "");
      $("editor").value = await res.text();
      return;
    } catch (e) { /* try next dir */ }
  }
  currentStem = "prog";
  status("cannot load " + name, true);
}

boot();
