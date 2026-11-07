/* mmix-web frontend. Drives unmodified MMIXware compiled to WASM:
   .mms --mmixal--> .mmo --mmix-sim--> stdout. */
"use strict";

const $ = (id) => document.getElementById(id);

const EXAMPLES = ["hello.mms", "fib.mms", "primes.mms", "sort.mms", "inout.mms", "echo.mms"];

let MMIXAL = null; // initMmixal constructor from wasm/mmixal.js
let MMIX = null;   // initMmix constructor from wasm/mmix.js
let currentMmo = null;

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
function runTool(Init, args, files, onOut) {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    Init({
      noInitialRun: true,
      thisProgram: args[0],
      arguments: args.slice(1),
      print: (t) => { stdout += t + "\n"; if (onOut) onOut(t + "\n"); },
      printErr: (t) => { stderr += t + "\n"; },
      onAbort: (what) => reject(new Error(what ? String(what) : "abort")),
    }).then((M) => {
      try {
        for (const f of files) M.FS.writeFile(f.name, f.data, f.opts);
        const rc = M.callMain(args.slice(1));
        resolve({ stdout, stderr, rc, FS: M.FS });
      } catch (e) {
        if (e && typeof e.status === "number") {
          // normal nonzero exit (e.g. mmixal reporting errors)
          resolve({ stdout, stderr, rc: e.status, FS: M.FS });
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
  const asmOut = $("asm-output");
  $("btn-run").disabled = true;
  currentMmo = null;
  asmOut.textContent = "";
  asmOut.className = "console";
  asmOut.__cls = "";
  status("assembling…");
  try {
    const { stdout, stderr, FS } = await runTool(MMIXAL, ["mmixal", "prog.mms"], [
      { name: "prog.mms", data: src, opts: { encoding: "utf8" } },
    ]);
    appendTo(asmOut, stderr + stdout, stderr.trim() ? "err" : "");
    let mmo = null;
    try {
      mmo = FS.readFile("prog.mmo");
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
  const simOut = $("sim-output");
  simOut.textContent = "";
  simOut.className = "console";
  simOut.__cls = "";
  status("running…");
  $("btn-run").disabled = true;
  try {
    const { stdout, stderr } = await runTool(MMIX, ["mmix", "-q", "prog"], [
      { name: "prog.mmo", data: currentMmo },
    ]);
    appendTo(simOut, stdout, "");
    if (stderr.trim()) appendTo(simOut, stderr, "err");
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

async function loadExample(name) {
  try {
    const res = await fetch("vendor/" + name);
    $("editor").value = await res.text();
  } catch (e) {
    status("cannot load " + name, true);
  }
}

boot();
