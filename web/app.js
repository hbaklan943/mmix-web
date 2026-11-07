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

let MMIXAL = null;
let MMIX = null;
let currentMmo = null;
let currentStem = "prog";
let currentListing = null;
let lastModule = null;
let editor = null;
let uploadedFiles = new Map();
let tabs = [{ name: "untitled.mms", content: "", stem: "untitled", mmo: null, listing: null }];
let activeTab = 0;
let suppressAutoRun = false;

// MMIXVD state: registers & memory inspector
let regFormat = "hex"; // "hex" | "dec"
let regFilter = "active"; // "active" | "all"
let prevRegMap = new Map();
let currentRegsList = [];
let speicherMode = "hexascii"; // "hexascii" | "ascii" | "octa"
let currentSpeicherAddr = 0x100n;

function defineMmixalMode() {
  if (!window.CodeMirror) return;
  if (CodeMirror.modes && CodeMirror.modes.mmixal) return;

  const opcodes = /^(?:TRAP|FCMP|FUN|FEQL|FADD|FIX|FSUB|FIXU|FLOT|FLOTU|SFLOT|SFLOTU|FMUL|FCMPE|FUNE|FEQLE|FDIV|FSQRT|FREM|FINT|MUL|MULU|DIV|DIVU|ADD|ADDU|SUB|SUBU|2ADDU|4ADDU|8ADDU|16ADDU|CMP|CMPU|NEG|NEGU|SL|SLU|SR|SRU|BN|BZ|BP|BOD|BNN|BNZ|BNP|BEV|PBN|PBZ|PBP|PBOD|PBNN|PBNZ|PBNP|PBEV|CSN|CSZ|CSP|CSOD|CSNN|CSNZ|CSNP|CSEV|ZSN|ZSZ|ZSP|ZSOD|ZSNN|ZSNZ|ZSNP|ZSEV|LDB|LDBU|LDW|LDWU|LDT|LDTU|LDO|LDOU|LDSF|LDHT|CSWAP|LDUNC|LDVTS|PRELD|PREGO|GO|STB|STBU|STW|STWU|STT|STTU|STO|STOU|STSF|STHT|STCO|STUNC|SYNCD|PREST|SYNCID|PUSHGO|OR|ORN|NOR|XOR|AND|ANDN|NAND|NXOR|BDIF|WDIF|TDIF|ODIF|MUX|SADD|MOR|MXOR|SETH|SETMH|SETML|SETL|INCH|INCMH|INCML|INCL|ORH|ORMH|ORML|ORL|ANDNH|ANDNMH|ANDNML|ANDNL|JMP|PUSHJ|GETA|PUT|POP|RESUME|SAVE|UNSAVE|SYNC|SWYM|GET|TRIP|SET|LDA)\b/i;
  const pseudoOps = /^(?:IS|LOC|BYTE|WYDE|TETRA|OCTA|PREFIX|GREG|LOCAL|BSPEC|ESPEC)\b/i;
  const specialRegs = /^(?:r[A-Z]|rBB|rTT|rWW|rXX|rYY|rZZ)\b/;
  const trapConsts = /^(?:Halt|Fopen|Fclose|Fread|Fgets|Fgetws|Fwrite|Fputs|Fputws|Fseek|Ftell|StdIn|StdOut|StdErr|TextRead|TextWrite|BinaryRead|BinaryWrite|BinaryReadWrite|Data_Segment|Pool_Segment|Stack_Segment)\b/;

  CodeMirror.defineSimpleMode("mmixal", {
    start: [
      { regex: /^\s*[*].*/, token: "comment" },
      { regex: /%.*/, token: "comment" },
      { regex: /"(?:[^"\\]|\\.)*"/, token: "string" },
      { regex: /'(?:[^'\\]|\\.)*'/, token: "string" },
      { regex: /#[0-9a-fA-F]+(?:\.[0-9a-fA-F]+)?\b/, token: "number" },
      { regex: /\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/, token: "number" },
      { regex: /\b\d+[FfBbHh]\b/, token: "number" },
      { regex: /\$[0-9]+\b/, token: "variable-2" },
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
    } catch (e) { /* assembler errors */ }
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
      switchBottomTab("tab-asm");
    }
  } catch (e) {
    appendTo(asmOut, String(e), "err");
    status("assembler crashed", true);
    switchBottomTab("tab-asm");
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
  switchBottomTab("tab-sim");
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
    if (M) {
      populateRegisters(M);
      listOutputFiles(M);
      renderSpeicher();
    }
    status("done");
  } catch (e) {
    appendTo(simOut, String(e), "err");
    status("simulation aborted", true);
  } finally {
    $("btn-run").disabled = false;
  }
}

/* ---------- MMIXVD: Resizable Splitters ---------- */
function initSplitters() {
  const vSplitter = $("v-splitter");
  const hSplitter = $("h-splitter");
  const topArea = $("top-area");
  const regsPane = $("regs-pane");
  const bottomPane = $("bottom-pane");
  const main = $("app-main");

  // Vertical splitter (left: editor, right: registers)
  let isDraggingV = false;
  vSplitter.addEventListener("mousedown", (e) => {
    isDraggingV = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  });

  // Horizontal splitter (top: editor+regs, bottom: inspector)
  let isDraggingH = false;
  hSplitter.addEventListener("mousedown", (e) => {
    isDraggingH = true;
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
  });

  window.addEventListener("mousemove", (e) => {
    if (isDraggingV) {
      const topRect = topArea.getBoundingClientRect();
      const newWidth = topRect.right - e.clientX;
      if (newWidth >= 160 && newWidth <= topRect.width - 200) {
        regsPane.style.width = newWidth + "px";
        regsPane.style.flex = "none";
        if (editor) editor.refresh();
      }
    }
    if (isDraggingH) {
      const mainRect = main.getBoundingClientRect();
      const newHeight = mainRect.bottom - e.clientY;
      if (newHeight >= 100 && newHeight <= mainRect.height - 120) {
        bottomPane.style.height = newHeight + "px";
        bottomPane.style.flex = "none";
        if (editor) editor.refresh();
      }
    }
  });

  window.addEventListener("mouseup", () => {
    if (isDraggingV || isDraggingH) {
      isDraggingV = false;
      isDraggingH = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      if (editor) editor.refresh();
    }
  });
}

/* ---------- MMIXVD: Bottom Inspector Tabs ---------- */
function initBottomTabs() {
  const tabBtns = document.querySelectorAll(".bottom-tab");
  tabBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      switchBottomTab(btn.dataset.tab);
    });
  });
}

function switchBottomTab(tabId) {
  const tabBtns = document.querySelectorAll(".bottom-tab");
  const contents = document.querySelectorAll(".bottom-tab-content");
  tabBtns.forEach((b) => b.classList.toggle("active", b.dataset.tab === tabId));
  contents.forEach((c) => c.classList.toggle("active", c.id === tabId));
  if (tabId === "tab-speicher") {
    renderSpeicher();
  }
}

/* ---------- MMIXVD: Register Inspector ---------- */
function initRegistersControls() {
  $("btn-reg-hex").onclick = () => {
    regFormat = "hex";
    $("btn-reg-hex").classList.add("active");
    $("btn-reg-dec").classList.remove("active");
    renderRegisters();
  };
  $("btn-reg-dec").onclick = () => {
    regFormat = "dec";
    $("btn-reg-dec").classList.add("active");
    $("btn-reg-hex").classList.remove("active");
    renderRegisters();
  };
  $("btn-reg-filter").onclick = () => {
    regFilter = regFilter === "active" ? "all" : "active";
    $("btn-reg-filter").classList.toggle("active", regFilter === "active");
    $("btn-reg-filter").textContent = regFilter === "active" ? "Active Only" : "All 256";
    renderRegisters();
  };
}

function populateRegisters(M) {
  lastModule = M;
  const ptr = M._mmix_get_g_ptr();
  const view = new DataView(M.HEAPU8.buffer);
  const ipPtr = M._mmix_get_inst_ptr_addr();
  const ipLo = view.getUint32(ipPtr, true);
  const ipHi = view.getUint32(ipPtr + 4, true);

  const ipVal = (BigInt(ipHi) << 32n) | BigInt(ipLo);
  const newRegs = [];

  // Special register inst_ptr
  newRegs.push({
    name: "inst_ptr",
    hi: ipHi,
    lo: ipLo,
    val: ipVal,
    isSpecial: true,
  });

  // 256 general & special architectural registers
  for (let i = 0; i <= 255; i++) {
    const off = ptr + i * 8;
    const lo = view.getUint32(off, true);
    const hi = view.getUint32(off + 4, true);
    const val = (BigInt(hi) << 32n) | BigInt(lo);
    const name = SPECIAL_NAMES[i] || `$${i}`;
    newRegs.push({
      name,
      num: i,
      hi,
      lo,
      val,
      isSpecial: !!SPECIAL_NAMES[i],
    });
  }

  // Populate #reg-output for 100% test compatibility
  const compatLines = ["inst_ptr = 0x" + ipHi.toString(16).padStart(8, "0") + ipLo.toString(16).padStart(8, "0"), ""];
  for (let i = 255; i >= 0; i--) {
    const off = ptr + i * 8;
    const lo = view.getUint32(off, true);
    const hi = view.getUint32(off + 4, true);
    const name = SPECIAL_NAMES[i] ? "  " + SPECIAL_NAMES[i] : "   $" + i;
    compatLines.push(name.padEnd(8) + " = 0x" + hi.toString(16).padStart(8, "0") + lo.toString(16).padStart(8, "0"));
  }
  $("reg-output").textContent = compatLines.join("\n");
  $("btn-mem").disabled = false;

  currentRegsList = newRegs;
  renderRegisters();
}

function renderRegisters() {
  const container = $("regs-list");
  if (!currentRegsList.length) return;
  container.innerHTML = "";

  const formatVal = (val, hi, lo) => {
    if (regFormat === "dec") {
      const signed = BigInt.asIntN(64, val);
      return signed.toString(10);
    }
    // hex (MMIXVD 16-hex format)
    return "0x" + hi.toString(16).padStart(8, "0") + lo.toString(16).padStart(8, "0");
  };

  const createRow = (item) => {
    const row = document.createElement("div");
    const prev = prevRegMap.get(item.name);
    const changed = prev !== undefined && prev !== item.val;
    row.className = "reg-row" + (item.isSpecial ? " special" : "") + (changed ? " changed" : "");
    const nameEl = document.createElement("span");
    nameEl.className = "reg-name";
    nameEl.textContent = item.name;
    const valEl = document.createElement("span");
    valEl.className = "reg-val";
    valEl.textContent = formatVal(item.val, item.hi, item.lo);
    row.appendChild(nameEl);
    row.appendChild(valEl);
    return row;
  };

  // 1) Active/Special registers
  const specialSection = document.createElement("div");
  specialSection.className = "reg-section-title";
  specialSection.textContent = "SPECIAL REGISTERS & POINTERS";
  container.appendChild(specialSection);

  for (const item of currentRegsList) {
    if (item.isSpecial) {
      if (regFilter === "active" && item.val === 0n && item.name !== "inst_ptr") continue;
      container.appendChild(createRow(item));
    }
  }

  // 2) General registers ($0..$255)
  const genSection = document.createElement("div");
  genSection.className = "reg-section-title";
  genSection.textContent = "GENERAL REGISTERS ($0 .. $255)";
  container.appendChild(genSection);

  let genCount = 0;
  for (const item of currentRegsList) {
    if (!item.isSpecial) {
      if (regFilter === "active" && item.val === 0n) continue;
      container.appendChild(createRow(item));
      genCount++;
    }
  }

  if (genCount === 0 && regFilter === "active") {
    const emptyRow = document.createElement("div");
    emptyRow.className = "regs-empty";
    emptyRow.textContent = "(All general registers are zero)";
    container.appendChild(emptyRow);
  }

  // Update prevRegMap
  for (const item of currentRegsList) {
    prevRegMap.set(item.name, item.val);
  }
}

/* ---------- MMIXVD: Speicher (Memory Viewer) ---------- */
function parseAddress(str) {
  if (!str) return 0x100n;
  const s = str.trim().toLowerCase();
  if (s === "data_segment" || s === "data") return 0x2000000000000000n;
  if (s === "pool_segment" || s === "pool") return 0x4000000000000000n;
  if (s === "stack_segment" || s === "stack") return 0x6000000000000000n;
  if (s === "code") return 0x100n;
  if (s.startsWith("#")) return BigInt("0x" + s.slice(1));
  if (s.startsWith("0x")) return BigInt(s);
  try {
    return BigInt(s);
  } catch (e) {
    return 0x100n;
  }
}

function initSpeicherControls() {
  $("btn-mem").onclick = () => {
    currentSpeicherAddr = parseAddress($("mem-addr").value);
    renderSpeicher();
  };
  $("mem-addr").onkeydown = (e) => {
    if (e.key === "Enter") {
      currentSpeicherAddr = parseAddress($("mem-addr").value);
      renderSpeicher();
    }
  };
  $("btn-mem-prev").onclick = () => {
    if (currentSpeicherAddr >= 64n) currentSpeicherAddr -= 64n;
    $("mem-addr").value = "0x" + currentSpeicherAddr.toString(16).padStart(16, "0");
    renderSpeicher();
  };
  $("btn-mem-next").onclick = () => {
    currentSpeicherAddr += 64n;
    $("mem-addr").value = "0x" + currentSpeicherAddr.toString(16).padStart(16, "0");
    renderSpeicher();
  };

  document.querySelectorAll(".preset-btn").forEach((btn) => {
    btn.onclick = () => {
      currentSpeicherAddr = parseAddress(btn.dataset.addr);
      $("mem-addr").value = "0x" + currentSpeicherAddr.toString(16).padStart(16, "0");
      renderSpeicher();
    };
  });

  const modes = [
    { id: "btn-mem-mode-hexascii", mode: "hexascii" },
    { id: "btn-mem-mode-ascii", mode: "ascii" },
    { id: "btn-mem-mode-octa", mode: "octa" },
  ];
  modes.forEach(({ id, mode }) => {
    $(id).onclick = () => {
      speicherMode = mode;
      modes.forEach((m) => $(m.id).classList.toggle("active", m.mode === mode));
      renderSpeicher();
    };
  });
}

function renderSpeicher() {
  const container = $("speicher-dump");
  if (!lastModule) {
    container.innerHTML = '<div class="speicher-empty">Simülasyon çalıştırıldığında bellek görüntülenecektir.</div>';
    return;
  }

  // Align to 16-byte boundary
  const base = currentSpeicherAddr & ~15n;
  $("mem-addr").value = "0x" + base.toString(16).padStart(16, "0");

  const lines = [];
  // Render 64 bytes (4 rows of 16 bytes)
  for (let r = 0; r < 4; r++) {
    const rowAddr = base + BigInt(r * 16);
    const bytes = [];
    for (let t = 0; t < 4; t++) {
      const tetraAddr = rowAddr + BigInt(t * 4);
      const h = Number((tetraAddr >> 32n) & 0xffffffffn);
      const l = Number(tetraAddr & 0xffffffffn);
      const val = (lastModule._mmix_mem_read_tetra(h, l) >>> 0);
      bytes.push((val >> 24) & 0xff);
      bytes.push((val >> 16) & 0xff);
      bytes.push((val >> 8) & 0xff);
      bytes.push(val & 0xff);
    }

    const addrStr = "0x" + rowAddr.toString(16).padStart(16, "0") + ":";

    if (speicherMode === "ascii") {
      const ascii = bytes.map((b) => (b >= 32 && b <= 126 ? String.fromCharCode(b) : "·")).join("");
      lines.push(`${addrStr}  ${ascii}`);
    } else if (speicherMode === "octa") {
      const octa1 = bytes.slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
      const octa2 = bytes.slice(8, 16).map((b) => b.toString(16).padStart(2, "0")).join("");
      lines.push(`${addrStr}  ${octa1}  ${octa2}`);
    } else {
      // Hex + ASCII
      const hexPart1 = bytes.slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join(" ");
      const hexPart2 = bytes.slice(8, 16).map((b) => b.toString(16).padStart(2, "0")).join(" ");
      const ascii = bytes.map((b) => (b >= 32 && b <= 126 ? String.fromCharCode(b) : ".")).join("");
      lines.push(`${addrStr}  ${hexPart1}   ${hexPart2}  |  ${ascii}`);
    }
  }

  container.innerHTML = `<pre class="speicher-code">${lines.join("\n")}</pre>`;
  $("mem-result").textContent = "Read 64 bytes at 0x" + base.toString(16);
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

  initSplitters();
  initBottomTabs();
  initRegistersControls();
  initSpeicherControls();

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
