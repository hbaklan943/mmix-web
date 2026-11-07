/* mmix-web frontend. Drives unmodified MMIXware compiled to WASM:
   .mms --mmixal--> .mmo --mmix-sim--> stdout. */
"use strict";

const $ = (id) => document.getElementById(id);

const EXAMPLES = [
  "hello.mms",
  "stdin-demo.mms",
  "fib.mms",
  "primes.mms",
  "sort.mms",
  "inout.mms",
  "echo.mms",
  "alpha.mms",
  "coolcomb.mms",
  "copy.mms",
  "cp.mms",
  "crypto.mms",
  "crypto1.mms",
  "crypto2.mms",
  "fftswap.mms",
  "fibgo.mms",
  "fibsub.mms",
  "fsubtest.mms",
  "halves.mms",
  "harm.mms",
  "hptest.mms",
  "iotest.mms",
  "iotest1.mms",
  "iotest2.mms",
  "number1.mms",
  "permu-heap.mms",
  "permu-langdon.mms",
  "permu-plain.mms",
  "permu-st.mms",
  "phi.mms",
  "poptest.mms",
  "popup.mms",
  "primes6.mms",
  "primesf.mms",
  "primesfx.mms",
  "primessf.mms",
  "primesx.mms",
  "pushtest.mms",
  "saddle1.mms",
  "saddle2.mms",
  "silly.mms",
  "sim.mms",
  "sortx.mms",
  "strcpy.mms",
  "sub1.mms",
  "sub2.mms",
  "test.mms",
  "traffic.mms",
  "valid.mms",
  "zero.mms",
];

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
let currentListing = null;
let lastModule = null;
let editor = null; // CodeMirror instance
let uploadedFiles = new Map();
let tabs = [{ name: "untitled.mms", content: "", stem: "untitled", mmo: null, listing: null }];
let activeTab = 0;
let suppressAutoRun = false;

function defineMmixalMode() {
  if (!window.CodeMirror) return;
  if (CodeMirror.modes && CodeMirror.modes.mmixal) return;

  const opcodes = /^(?:TRAP|FCMP|FUN|FEQL|FADD|FIX|FSUB|FIXU|FLOT|FLOTI|FLOTU|FLOTUI|SFLOT|SFLOTI|SFLOTU|SFLOTUI|FMUL|FDIV|FSQRT|FREM|FINT|MUL|MULI|MULU|MULUI|DIV|DIVI|DIVU|DIVUI|ADD|ADDI|ADDU|ADDUI|SUB|SUBI|SUBU|SUBUI|2ADDU|2ADDUI|4ADDU|4ADDUI|8ADDU|8ADDUI|NEG|NEGI|NEGU|NEGUI|CMP|CMPI|CMPU|CMPUI|CSN|CSNI|CSZ|CSZI|CSP|CSPI|CSOD|CSODI|CSNN|CSNNI|CSNZ|CSNZI|CSNP|CSNPI|CSEV|CSEVI|ZSN|ZSNI|ZSZ|ZSZI|ZSP|ZSPI|ZSOD|ZSODI|ZSNN|ZSNNI|ZSNZ|ZSNZI|ZSNP|ZSNPI|ZSEV|ZSEVI|LDB|LDBI|LDBU|LDBUI|LDW|LDWI|LDWU|LDWUI|LDT|LDTI|LDTU|LDTUI|LDO|LDOI|LDOU|LDHT|LDHTI|CSWAP|CSWAPI|LDUNC|LDUNCI|LDVTS|LDVTSI|PRELD|PRELDI|PREGO|PREGOI|GO|GOI|STB|STBI|STBU|STBUI|STW|STWI|STWU|STWUI|STT|STTI|STTU|STTUI|STO|STOI|STOU|STOUI|STSF|STSFI|STHT|STHTI|STCO|STCOI|STUNC|STUNCI|SYNCD|SYNCDI|PREST|PRESTI|SYNCID|SYNCIDI|PUSHGO|PUSHGOI|OR|ORI|ORN|ORNI|NOR|NORI|XOR|XORI|AND|ANDI|ANDN|ANDNI|NAND|NANDI|NXOR|NXORI|BDIF|BDIFI|WDIF|WDIFI|TDIF|TDIFI|ODIF|ODIFI|MUX|MUXI|SADD|SADDI|MOR|MORI|MXOR|MXORI|SETH|SETMH|SETML|SETL|INCH|INCMH|INCML|INCL|ORH|ORMH|ORML|ORL|ANDNH|ANDNMH|ANDNML|ANDNL|JMP|JMPB|PUSHJ|PUSHJB|GETA|GETAB|PUT|PUTI|POP|RESUME|SAVE|UNSAVE|SYNC|SWYM|GET|TRIP|SET)\b/i;
  const pseudoOps = /^(?:IS|LOC|BYTE|WYDE|TETRA|OCTA|PREFIX|GREG|LOCAL|BSPEC|ESPEC)\b/i;
  const specialRegs = /^(?:r[A-Z]|rBB|rTT|rWW|rXX|rYY|rZZ)\b/;
  const trapConsts = /^(?:Halt|Fopen|Fclose|Fread|Fgets|Fgetws|Fwrite|Fputs|Fputws|Fseek|Ftell|StdIn|StdOut|StdErr|TextRead|TextWrite|BinaryRead|BinaryWrite|BinaryReadWrite)\b/;

  CodeMirror.defineSimpleMode("mmixal", {
    start: [
      { regex: /%.*/, token: "comment" },
      { regex: /"(?:[^"\\]|\\.)*"/, token: "string" },
      { regex: /#?[0-9a-fA-F]+(?:\.[0-9a-fA-F]+)?/, token: "number" },
      { regex: /\$[0-9]+/, token: "variable-2" },
      { regex: specialRegs, token: "variable-2" },
      { regex: opcodes, token: "keyword" },
      { regex: pseudoOps, token: "builtin" },
      { regex: trapConsts, token: "atom" },
      { regex: /[A-Za-z_][\w]*/, token: "variable" },
    ],
  });
}

function setEditorContent(val) {
  suppressAutoRun = true;
  editor.setValue(val || "");
  suppressAutoRun = false;
}

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
   Returns { stdout, stderr, rc, FS, module } */
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

/* ---------- tabs ---------- */
function saveActiveTab() {
  if (!editor || !tabs[activeTab]) return;
  tabs[activeTab].content = editor.getValue();
  tabs[activeTab].stem = currentStem;
  tabs[activeTab].mmo = currentMmo;
  tabs[activeTab].listing = currentListing;
}

function renderTabs() {
  const bar = $("tab-bar");
  const btn = $("btn-new-tab");
  bar.innerHTML = "";
  tabs.forEach((t, i) => {
    const el = document.createElement("span");
    el.className = "tab" + (i === activeTab ? " active" : "");
    el.textContent = t.name;
    el.onclick = () => switchTab(i);
    const close = document.createElement("span");
    close.className = "close";
    close.textContent = "×";
    close.onclick = (e) => { e.stopPropagation(); closeTab(i); };
    el.appendChild(close);
    bar.appendChild(el);
  });
  bar.appendChild(btn);
}

function switchTab(i) {
  if (i < 0 || i >= tabs.length) return;
  saveActiveTab();
  activeTab = i;
  currentStem = tabs[i].stem;
  currentMmo = tabs[i].mmo || null;
  currentListing = tabs[i].listing || null;
  setEditorContent(tabs[i].content || "");
  $("btn-run").disabled = !currentMmo;
  $("btn-download-mmo").disabled = !currentMmo;
  $("btn-download-lst").disabled = !currentListing;
  renderTabs();
}

function newTab(name) {
  saveActiveTab();
  const n = name || ("untitled" + (tabs.length + 1) + ".mms");
  tabs.push({ name: n, content: "", stem: n.replace(/\.mms$/, "") || "prog", mmo: null, listing: null });
  activeTab = tabs.length - 1;
  currentStem = tabs[activeTab].stem;
  currentMmo = null;
  currentListing = null;
  setEditorContent("");
  $("btn-run").disabled = true;
  $("btn-download-mmo").disabled = true;
  $("btn-download-lst").disabled = true;
  renderTabs();
}

function closeTab(i) {
  if (tabs.length <= 1) {
    tabs[0] = { name: "untitled.mms", content: "", stem: "untitled", mmo: null, listing: null };
    activeTab = 0;
    currentStem = "untitled";
    currentMmo = null;
    currentListing = null;
    setEditorContent("");
    $("btn-run").disabled = true;
    $("btn-download-mmo").disabled = true;
    $("btn-download-lst").disabled = true;
    renderTabs();
    return;
  }
  saveActiveTab();
  tabs.splice(i, 1);
  if (activeTab >= tabs.length) activeTab = tabs.length - 1;
  if (activeTab < 0) activeTab = 0;
  currentStem = tabs[activeTab].stem;
  currentMmo = tabs[activeTab].mmo || null;
  currentListing = tabs[activeTab].listing || null;
  setEditorContent(tabs[activeTab].content || "");
  $("btn-run").disabled = !currentMmo;
  $("btn-download-mmo").disabled = !currentMmo;
  $("btn-download-lst").disabled = !currentListing;
  renderTabs();
}

/* ---------- assemble / run ---------- */
async function assemble() {
  const src = editor.getValue();
  const stem = currentStem;
  const asmOut = $("asm-output");
  $("btn-run").disabled = true;
  $("btn-download-mmo").disabled = true;
  $("btn-download-lst").disabled = true;
  currentListing = null;
  currentMmo = null;
  if (tabs[activeTab]) {
    tabs[activeTab].mmo = null;
    tabs[activeTab].listing = null;
  }
  asmOut.textContent = "";
  asmOut.className = "console";
  asmOut.__cls = "";
  editor.clearGutter("errors");
  (editor.getAllMarks() || []).forEach((m) => m.clear());
  status("assembling…");
  try {
    const { stdout, stderr, FS } = await runTool(MMIXAL, ["mmixal", "-x", "-b", "250", "-l", stem + ".lst", stem + ".mms"], [
      { name: stem + ".mms", data: src, opts: { encoding: "utf8" } },
    ], null, $("stdin").value);
    appendTo(asmOut, stderr + stdout, stderr.trim() ? "err" : "");
    // inline error markers
    const errLines = new Set();
    const re = /line\s+(\d+)/gi;
    let m;
    while ((m = re.exec(stderr)) !== null) errLines.add(parseInt(m[1], 10));
    const re2 = /At line\s+(\d+)/gi;
    while ((m = re2.exec(stderr)) !== null) errLines.add(parseInt(m[1], 10));
    for (const ln of errLines) {
      if (ln < 1 || ln > editor.lineCount()) continue;
      const marker = document.createElement("span");
      marker.className = "error-marker";
      marker.textContent = "●";
      marker.title = "error";
      editor.setGutterMarker(ln - 1, "errors", marker);
      editor.markText({ line: ln - 1, ch: 0 }, { line: ln - 1, ch: Infinity }, { className: "cm-error-line" });
    }
    let mmo = null;
    try {
      mmo = FS.readFile(stem + ".mmo");
    } catch (e) { /* assembler errors: no output */ }
    if (mmo) {
      currentMmo = mmo;
      if (tabs[activeTab]) tabs[activeTab].mmo = mmo;
      status(`assembled ${mmo.length} bytes - Ready`);
      updateHash();
      try { currentListing = new TextDecoder().decode(FS.readFile(stem + ".lst")); } catch (e) { currentListing = null; }
      if (tabs[activeTab]) tabs[activeTab].listing = currentListing;
      $("btn-run").disabled = !MMIX;
      $("btn-download-mmo").disabled = false;
      $("btn-download-lst").disabled = !currentListing;
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
    const files = [{ name: stem + ".mmo", data: currentMmo }];
    for (const [name, data] of uploadedFiles) files.push({ name, data });
    const { stdout, stderr, module: M } = await runTool(MMIX, args, files, null, $("stdin").value);
    appendTo(simOut, stdout, "");
    if (stderr.trim()) appendTo(simOut, stderr, "err");
    if (M) { populateRegisters(M); listOutputFiles(M); }
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
  $("file-upload").onchange = (e) => {
    for (const f of e.target.files) {
      const r = new FileReader();
      r.onload = () => uploadedFiles.set(f.name, new Uint8Array(r.result));
      r.readAsArrayBuffer(f);
    }
  };
  $("examples").onchange = () => loadExample($("examples").value);
  $("btn-new-tab").onclick = () => newTab();

  // drag-and-drop .mms files into the editor
  const pane = $("editor-pane");
  pane.addEventListener("dragover", (e) => { e.preventDefault(); pane.classList.add("drag"); });
  pane.addEventListener("dragleave", () => pane.classList.remove("drag"));
  pane.addEventListener("drop", async (e) => {
    e.preventDefault();
    pane.classList.remove("drag");
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (!f) return;
    currentStem = f.name.replace(/\.mms$/, "") || "prog";
    tabs[activeTab].name = f.name;
    tabs[activeTab].stem = currentStem;
    tabs[activeTab].content = await f.text();
    tabs[activeTab].mmo = null;
    tabs[activeTab].listing = null;
    currentMmo = null;
    currentListing = null;
    $("btn-run").disabled = true;
    $("btn-download-mmo").disabled = true;
    $("btn-download-lst").disabled = true;
    setEditorContent(tabs[activeTab].content);
    renderTabs();
    status("loaded " + f.name);
  });

  $("btn-assemble").onclick = assemble;
  $("btn-run").onclick = run;
  $("btn-download-mmo").onclick = () => {
    if (!currentMmo) return;
    const blob = new Blob([currentMmo]);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = currentStem + ".mmo"; a.click();
    URL.revokeObjectURL(url);
  };
  $("btn-download-lst").onclick = () => {
    if (!currentListing) return;
    const blob = new Blob([currentListing], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = currentStem + ".lst"; a.click();
    URL.revokeObjectURL(url);
  };
  $("btn-share").onclick = async () => {
    updateHash();
    const url = location.href;
    try { await navigator.clipboard.writeText(url); status("share link copied"); }
    catch (e) { window.prompt("Copy this share link:", url); }
  };
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

  defineMmixalMode();
  editor = CodeMirror.fromTextArea($("editor"), {
    mode: "mmixal",
    lineNumbers: true,
    gutters: ["CodeMirror-linenumbers", "errors"],
    tabSize: 8,
    indentUnit: 8,
    extraKeys: {
      "Ctrl-Enter": assemble,
      "Cmd-Enter": assemble,
      Tab: (cm) => {
        if (cm.somethingSelected()) {
          cm.indentSelection("add");
          return;
        }
        const cursor = cm.getCursor();
        const col = cursor.ch;
        // Standard 8-column multiples: 8 (Opcode), 16 (Operands), 32 (Comment)
        const STOPS = [8, 16, 32];
        let target = STOPS.find((s) => s > col);
        if (!target) target = Math.floor(col / 8 + 1) * 8;
        cm.replaceSelection(" ".repeat(target - col));
      },
      "Shift-Tab": (cm) => {
        if (cm.somethingSelected()) {
          cm.indentSelection("subtract");
          return;
        }
        const cursor = cm.getCursor();
        const col = cursor.ch;
        const line = cm.getLine(cursor.line);
        const STOPS = [0, 8, 16, 32];
        let prev = 0;
        for (const s of STOPS) {
          if (s < col) prev = s;
        }
        const prefix = line.slice(prev, col);
        if (/^\s+$/.test(prefix)) {
          cm.replaceRange("", { line: cursor.line, ch: prev }, cursor);
        } else {
          cm.setCursor({ line: cursor.line, ch: prev });
        }
      },
    },
  });
  editor.setValue("");

  const shared = decodeProgram(location.hash.slice(1));
  if (shared) {
    editor.setValue(shared);
    currentStem = "shared";
    tabs[0].content = shared;
    tabs[0].name = "shared.mms";
    tabs[0].stem = "shared";
  }
  renderTabs();

  const isLight = localStorage.getItem("mmix-theme") === "light";
  applyTheme(isLight);
  $("btn-theme").onclick = () => applyTheme(!document.documentElement.classList.contains("light"));

  let autoTimer = null;
  editor.on("change", () => {
    if (suppressAutoRun || !$("opt-autorun").checked) return;
    clearTimeout(autoTimer);
    autoTimer = setTimeout(() => { assemble().then(() => { if (currentMmo) run(); }); }, 900);
  });

  window.loadExample = loadExample;
  try {
    await loadScript("wasm/mmixal.js");
    await loadScript("wasm/mmix.js");
    MMIXAL = window.initMmixal;
    MMIX = window.initMmix;
  } catch (e) {
    status(String(e), true);
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

function encodeProgram(src) {
  try { return btoa(unescape(encodeURIComponent(src))); } catch (e) { return ""; }
}
function decodeProgram(hash) {
  try { return decodeURIComponent(escape(atob(hash))); } catch (e) { return ""; }
}
function updateHash() {
  if (!editor) return;
  const src = editor.getValue();
  const enc = encodeProgram(src);
  if (!enc) return;
  try { history.replaceState(null, "", "#" + enc); } catch (e) {}
}

function applyTheme(light) {
  document.documentElement.classList.toggle("light", light);
  const btn = $("btn-theme");
  if (btn) btn.textContent = light ? "☀️ Light" : "🌙 Dark";
  try { localStorage.setItem("mmix-theme", light ? "light" : "dark"); } catch (e) {}
}

function hex64(h, l) {
  return h.toString(16).padStart(8, "0") + l.toString(16).padStart(8, "0");
}

function listOutputFiles(M) {
  const out = $("file-list");
  out.textContent = "";
  const skip = new Set([".", "..", "dev", "proc", "tmp", "home"]);
  let names = [];
  try { names = M.FS.readdir("/").filter((n) => !skip.has(n)); } catch (e) { names = []; }
  if (uploadedFiles.size) {
    out.textContent += "uploaded: " + [...uploadedFiles.keys()].join(", ") + "\n";
  }
  if (!names.length) { out.textContent += "(no files created by the program)\n"; return; }
  for (const n of names) {
    let size = 0, isFile = false;
    try { const st = M.FS.stat("/" + n); isFile = M.FS.isFile(st.mode); size = st.size; } catch (e) {}
    if (!isFile) continue;
    const btn = document.createElement("button");
    btn.textContent = `download ${n} (${size} B)`;
    btn.onclick = () => {
      const data = M.FS.readFile("/" + n);
      const blob = new Blob([data]);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = n; a.click();
      URL.revokeObjectURL(url);
    };
    out.appendChild(btn);
    out.appendChild(document.createTextNode("\n"));
  }
}

async function loadExample(name) {
  const paths = name === "stdin-demo.mms"
    ? ["examples/stdin-demo.mms", "../examples/stdin-demo.mms", "vendor/stdin-demo.mms"]
    : ["vendor/" + name, "../vendor/" + name, "examples/" + name, "../examples/" + name];
  for (const path of paths) {
    try {
      const res = await fetch(path);
      if (!res.ok) continue;
      currentStem = name.replace(/\.mms$/, "");
      tabs[activeTab].name = name;
      tabs[activeTab].stem = currentStem;
      tabs[activeTab].content = await res.text();
      tabs[activeTab].mmo = null;
      tabs[activeTab].listing = null;
      currentMmo = null;
      currentListing = null;
      $("btn-run").disabled = true;
      $("btn-download-mmo").disabled = true;
      $("btn-download-lst").disabled = true;
      setEditorContent(tabs[activeTab].content);
      if ($("examples").value !== name) $("examples").value = name;
      renderTabs();
      return;
    } catch (e) { /* try next path */ }
  }
  currentStem = "prog";
  status("cannot load " + name, true);
}

boot();
