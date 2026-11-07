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

let toolchainReady = false;
let currentMmo = null;
let currentStem = "prog";
let currentListing = null;
let lastModule = false; // true once a run finished and the worker holds its state
let editor = null;
let uploadedFiles = new Map();
let tabs = [{ name: "untitled.mms", content: "", stem: "untitled", mmo: null, listing: null }];
let activeTab = 0;
let suppressAutoRun = false;

// MMIXVD state: registers & memory inspector
let prevRegMap = new Map();
let running = false;
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
  // CodeMirror normalises CRLF, so remember what the editor really holds;
  // `loaded` is what "unmodified" is compared against.
  if (tabs[activeTab]) tabs[activeTab].content = editor.getValue();
  applyBreakpointMarkers(tabs[activeTab] ? tabs[activeTab].breakpoints : []);
}

/* ---------- output panes ---------- */
function appendTo(el, chunk, cls) {
  if (!chunk) return;
  // Append as its own span so stderr (red) never wipes earlier stdout.
  const span = document.createElement("span");
  if (cls) span.className = cls;
  span.textContent = chunk;
  el.appendChild(span);
  el.scrollTop = el.scrollHeight;
}

// Append a styled one-line note (not part of the program's own output).
function noteTo(el, text, kind) {
  const n = document.createElement("div");
  n.className = "console-note " + (kind || "");
  n.textContent = text;
  el.appendChild(n);
  el.scrollTop = el.scrollHeight;
}
function stamp() {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
function setBadge(id, text, kind) {
  const b = $(id);
  if (!b) return;
  b.textContent = text;
  b.className = "badge" + (kind ? " " + kind : "");
}

function updateRunButton() {
  const paused = !!(dbgSession && dbgSession.paused);
  const idle = toolchainReady && !running;
  $("btn-run").disabled = !idle;
  $("btn-stop").disabled = !running;
  $("btn-assemble").disabled = !idle;
  $("btn-debug").disabled = !idle;
  for (const id of ["btn-step", "btn-over", "btn-continue"]) $(id).disabled = !(idle || paused);
  $("btn-out").disabled = !paused;
  $("btn-break").disabled = !(dbgSession && !dbgSession.paused);
  document.body.classList.toggle("is-debugging", !!dbgSession);
}

function status(text, isError) {
  const el = $("status");
  el.textContent = text;
  el.title = text;
  el.classList.toggle("error", !!isError);
}

/* ---------- simulator worker client ---------- */
// mmixal and mmix run in sim-worker.js. A program that never halts only
// blocks the worker; Stop terminates it and a fresh one starts on demand.
const sim = {
  worker: null,
  ready: null,
  seq: 0,
  pending: new Map(),
  onOutput: null, // (stream, text) => void while a run is streaming
  onPaused: null, // (state) => void while a debug session is paused

  start() {
    if (this.worker) return this.ready;
    const w = new Worker("sim-worker.js");
    this.worker = w;
    this.ready = new Promise((resolve, reject) => {
      w.onmessage = (e) => {
        const m = e.data;
        if (m.type === "ready") { resolve(); return; }
        if (m.type === "out") { if (this.onOutput) this.onOutput(m.stream, m.text); return; }
        if (m.type === "paused") { if (this.onPaused) this.onPaused(m.state); return; }
        const p = this.pending.get(m.id);
        if (!p) return;
        this.pending.delete(m.id);
        if (m.ok) p.resolve(m.result); else p.reject(new Error(m.error));
      };
      w.onerror = (e) => {
        e.preventDefault();
        const err = new Error(e.message || "simulator worker failed to load");
        reject(err);
        this.fail(err);
      };
    });
    return this.ready;
  },

  async call(type, data = {}, transfer = []) {
    await this.start();
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, type, ...data }, transfer);
    });
  },

  fail(err) {
    for (const p of this.pending.values()) p.reject(err);
    this.pending.clear();
    if (this.worker) this.worker.terminate();
    this.worker = null;
    this.ready = null;
  },

  stop() {
    const err = new Error("stopped");
    err.stopped = true;
    this.fail(err);
  },
};

/* ---------- tabs ---------- */
function blockedByDebug() {
  if (!dbgSession) return false;
  status("stop the debug session first (Shift+F5)", true);
  return true;
}

function saveActiveTab() {
  if (!editor || !tabs[activeTab]) return;
  tabs[activeTab].content = editor.getValue();
  tabs[activeTab].stem = currentStem;
  tabs[activeTab].mmo = currentMmo;
  tabs[activeTab].listing = currentListing;
  tabs[activeTab].breakpoints = breakpointLines();
}

function renderTabs() {
  scheduleSessionSave();
  const bar = $("tab-bar");
  const btn = $("btn-new-tab");
  const fmt = $("editor-tools");
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
  bar.appendChild(fmt);
}

function switchTab(i) {
  if (blockedByDebug()) return;
  if (i < 0 || i >= tabs.length) return;
  saveActiveTab();
  activeTab = i;
  currentStem = tabs[i].stem;
  currentMmo = tabs[i].mmo || null;
  currentListing = tabs[i].listing || null;
  setEditorContent(tabs[i].content || "");
  updateRunButton();
  $("btn-download-mmo").disabled = !currentMmo;
  $("btn-download-lst").disabled = !currentListing;
  renderTabs();
}

function newTab(name) {
  if (blockedByDebug()) return;
  saveActiveTab();
  const n = name || ("untitled" + (tabs.length + 1) + ".mms");
  tabs.push({ name: n, content: "", stem: n.replace(/\.mms$/, "") || "prog", mmo: null, listing: null });
  activeTab = tabs.length - 1;
  currentStem = tabs[activeTab].stem;
  currentMmo = null;
  currentListing = null;
  setEditorContent("");
  updateRunButton();
  $("btn-download-mmo").disabled = true;
  $("btn-download-lst").disabled = true;
  renderTabs();
}

function closeTab(i) {
  if (blockedByDebug()) return;
  if (tabs.length <= 1) {
    tabs[0] = { name: "untitled.mms", content: "", stem: "untitled", mmo: null, listing: null };
    activeTab = 0;
    currentStem = "untitled";
    currentMmo = null;
    currentListing = null;
    setEditorContent("");
    updateRunButton();
    $("btn-download-mmo").disabled = true;
    $("btn-download-lst").disabled = true;
    renderTabs();
    return;
  }
  saveActiveTab();
  tabs.splice(i, 1);
  if (i < activeTab) activeTab--;
  if (activeTab >= tabs.length) activeTab = tabs.length - 1;
  if (activeTab < 0) activeTab = 0;
  currentStem = tabs[activeTab].stem;
  currentMmo = tabs[activeTab].mmo || null;
  currentListing = tabs[activeTab].listing || null;
  setEditorContent(tabs[activeTab].content || "");
  updateRunButton();
  $("btn-download-mmo").disabled = !currentMmo;
  $("btn-download-lst").disabled = !currentListing;
  renderTabs();
}

/* ---------- assemble / run ---------- */
async function assemble() {
  if (running) {
    status(dbgSession ? "stop the debug session first (Shift+F5)" : "wait for the program to finish, or Stop it", true);
    return;
  }
  const src = editor.getValue();
  const stem = currentStem;
  const asmOut = $("asm-output");
  updateRunButton();
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
  setBadge("asm-badge", "");
  editor.clearGutter("errors");
  (editor.getAllMarks() || []).forEach((m) => m.clear());
  status("assembling…");
  try {
    const { stdout, stderr, mmo: asmMmo, listing } = await sim.call("assemble", { src, stem });
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
    let mmo = asmMmo;
    // mmixal ends with "(One error was found.)" / "(2 errors were found.)" and
    // may still write a partial .mmo, so the summary decides success.
    const words = { one: 1, two: 2, three: 3 };
    const count = (kind) => {
      const m = new RegExp("\\((\\w+) " + kind + "s? (?:was|were) found", "i").exec(stderr);
      return m ? (Number(m[1]) || words[m[1].toLowerCase()] || 1) : 0;
    };
    const errors = count("error");
    const warnings = count("warning");
    if (errors) mmo = null;
    if (mmo) {
      noteTo(asmOut, `${stamp()}  ✓ ${stem}.mms assembled — ${mmo.length} bytes → ${stem}.mmo` +
        (warnings ? `, ${warnings} warning${warnings > 1 ? "s" : ""}` : ", no errors"), "ok");
      setBadge("asm-badge", warnings ? String(warnings) : "✓", warnings ? "warn" : "ok");
      currentMmo = mmo;
      prevRegMap.clear();
      if (tabs[activeTab]) { tabs[activeTab].mmo = mmo; tabs[activeTab].assembledSrc = src; }
      status(`assembled ${mmo.length} bytes - Ready`);
      currentListing = listing;
      symbols = parseSymbols(listing);
      renderSymbols();
      if (tabs[activeTab]) tabs[activeTab].listing = currentListing;
      updateRunButton();
      $("btn-download-mmo").disabled = false;
      $("btn-download-lst").disabled = !currentListing;
    } else {
      for (const hint of undefinedSymbolHints(src, stderr)) noteTo(asmOut, "Hint: " + hint, "hint");
      noteTo(asmOut, `${stamp()}  ✗ assembly failed` + (errors ? ` — ${errors} error${errors > 1 ? "s" : ""}` : ""), "bad");
      setBadge("asm-badge", errors ? String(errors) : "!", "bad");
      status("assembler error", true);
      showPanel("panel-asm");
    }
  } catch (e) {
    appendTo(asmOut, String(e), "err");
    status("assembler crashed", true);
    showPanel("panel-asm");
  }
}

async function run({ timeoutMs = 0, debug = false, autoContinue = false } = {}) {
  if (running || !toolchainReady) return;
  const tab = tabs[activeTab];
  if (!currentMmo || !tab || tab.assembledSrc !== editor.getValue()) {
    await assemble();
    if (!currentMmo) return;
  }
  const stem = currentStem;
  const simOut = $("sim-output");
  simOut.textContent = "";
  setBadge("sim-badge", "");
  running = true;
  if (debug) {
    dbgSession = { paused: false, autoContinue };
    dbgCarry = "";
    prevRegMap.clear(); // highlight what each step changes
    editor.setOption("readOnly", true);
    sim.onPaused = onDebugPaused;
  }
  updateRunButton();
  showPanel("panel-output");

  const trace = $("opt-trace").checked;
  const profile = $("opt-profile").checked;
  const stats = $("opt-stats").checked;
  const flags = [];
  if (!trace && !profile && !stats) flags.push("-q");
  // mmix wants option values glued to the flag: -t<n>, -l<n>
  if (trace) flags.push("-t1000000", "-l5");
  if (profile) flags.push("-P");
  if (stats) flags.push("-s");

  // Output streams in while the program runs.
  let sawStdout = false;
  sim.onOutput = (stream, text) => {
    if (stream === "stdout") sawStdout = true;
    if (stream === "sim" && debug) text = filterDebugSimText(text);
    // Simulator messages (trace, stats) are dimmed; program output stays bright.
    appendTo(simOut, text, stream === "stderr" ? "err" : stream === "sim" ? "sim" : "");
  };
  const t0 = performance.now();
  const tick = setInterval(() => {
    if (dbgSession && dbgSession.paused) return;
    if ($("status").textContent === "breaking…") return;
    status(`running… ${((performance.now() - t0) / 1000).toFixed(1)} s`);
  }, 250);
  status("running…");
  const limit = timeoutMs ? setTimeout(() => { sim.stop(); }, timeoutMs) : null;

  try {
    const r = await sim.call(debug ? "debug" : "run", {
      stem,
      mmo: currentMmo,
      src: tab.assembledSrc,
      stdin: $("stdin").value,
      flags,
      breakpoints: breakpointLines(),
      uploads: [...uploadedFiles].map(([name, data]) => ({ name, data })),
    });
    lastModule = true;
    populateRegisters(r.regs);
    lastRunFiles = r.files;
    listOutputFiles(r.files);
    renderSpeicher();
    const secs = ((performance.now() - t0) / 1000).toFixed(2);
    noteTo(simOut, debug
      ? `${stamp()}  — program finished, debug session ended${sawStdout ? "" : " (no output)"} —`
      : `${stamp()}  — program finished in ${secs} s${sawStdout ? "" : " (no output)"} —`, r.stderr.trim() ? "bad" : "dim");
    setBadge("sim-badge", "✓", "ok");
    status("done");
  } catch (e) {
    lastModule = false;
    if (e.stopped) {
      const why = timeoutMs && performance.now() - t0 >= timeoutMs - 50
        ? `stopped after ${timeoutMs / 1000} s (Auto-run limit) — press Run to run without a limit`
        : debug ? "debug session stopped" : "stopped by user";
      noteTo(simOut, `${stamp()}  ■ ${why}. Registers and memory are not available for a stopped run.`, "bad");
      setBadge("sim-badge", "■", "warn");
      status("stopped", true);
      clearRegisters("The program was stopped before it halted.");
    } else {
      appendTo(simOut, String(e), "err");
      setBadge("sim-badge", "!", "bad");
      status("simulation aborted", true);
    }
  } finally {
    clearInterval(tick);
    clearTimeout(limit);
    sim.onOutput = null;
    sim.onPaused = null;
    running = false;
    if (debug) {
      dbgSession = null;
      dbgPendingCursor = null;
      setPcLine(null);
      editor.setOption("readOnly", false);
    }
    updateRunButton();
  }
}

function stopRun() {
  if (running) sim.stop();
}

/* ---------- debugger (step / breakpoints) ---------- */
// A debug session runs the program under mmix-sim's interactive mode in the
// worker (see sim-worker.js / tools/mmix-debug.c). Like MMIXVD, the arrow
// marks the instruction that was executed last, and registers and memory
// show the state right after it. Breakpoints stop after their line ran.
let dbgSession = null; // { paused, line, ip, inst, regs, autoContinue }

const OP_PUSHJ = [0xf2, 0xf3], OP_PUSHGO = [0xbe, 0xbf];

function debugStart({ autoContinue = false } = {}) {
  if (running) return;
  run({ debug: true, autoContinue });
}

// tempAddr: one-shot stop; tempMode 1 = before executing it, 2 = after.
// markAddr: instruction to show as "executed" at the next stop (step over /
// out show the call itself, not the last instruction of the subroutine).
function debugCommand(text, { tempAddr = null, tempMode = 1, markAddr = null } = {}) {
  if (!dbgSession || !dbgSession.paused) return;
  dbgSession.paused = false;
  setPcLine(null);
  status("running…");
  updateRunButton();
  sim.call("cmd", { text, tempAddr, tempMode, markAddr }).catch(() => {});
}

function debugStep() {
  if (!dbgSession) return debugStart();
  debugCommand("n");
}

function debugOver() {
  if (!dbgSession) return debugStart();
  const op = parseInt((dbgSession.inst || "00").slice(0, 2), 16);
  if (OP_PUSHJ.includes(op) || OP_PUSHGO.includes(op)) {
    // Run the whole subroutine: stop when it returns to the instruction
    // after the call, and mark the call as the executed line.
    const next = (BigInt("0x" + dbgSession.ip) + 4n) & 0xffffffffffffffffn;
    debugCommand("C", { tempAddr: next.toString(16), markAddr: dbgSession.ip });
  } else {
    debugCommand("n");
  }
}

function debugOut() {
  if (!dbgSession) return;
  // rJ holds the return address of the current subroutine (set by PUSHJ).
  const rJ = BigInt("0x" + dbgSession.regs.g[4]);
  if (rJ === 0n) { status("not inside a subroutine (rJ = 0)", true); return; }
  // Stop back in the caller and mark its PUSHJ (the instruction before rJ).
  debugCommand("C", { tempAddr: rJ.toString(16), markAddr: (rJ - 4n).toString(16) });
}

function debugContinue() {
  if (!dbgSession) return debugStart({ autoContinue: true });
  debugCommand("C");
}

async function runToCursor() {
  const line = editor.getCursor().line + 1;
  if (!dbgSession) {
    // Start a session that stops at the cursor line.
    dbgPendingCursor = line;
    return debugStart();
  }
  if (!dbgSession.paused) return;
  const addr = await sim.call("addrOfLine", { line });
  if (!addr) { status(`line ${line} has no code to stop at`, true); return; }
  debugCommand("C", { tempAddr: addr, tempMode: 2 }); // stop after that line ran
}
let dbgPendingCursor = null;

function onDebugPaused(state) {
  if (!dbgSession) return;
  // The first stop is the initial state: record it so the next stop can
  // highlight what changed, even when we continue straight away.
  if (!dbgSession.seenFirst) {
    dbgSession.seenFirst = true;
    lastModule = true;
    populateRegisters(state.regs);
    // Like MMIXVD, Debug starts by executing the first instruction.
    if (!dbgSession.autoContinue && !dbgPendingCursor) {
      dbgSession.paused = true;
      debugCommand("n");
      return;
    }
  }
  if (dbgSession.autoContinue) { dbgSession.autoContinue = false; dbgSession.paused = true; dbgSession.inst = state.inst; debugCommand("C"); return; }
  if (dbgPendingCursor) {
    const line = dbgPendingCursor;
    dbgPendingCursor = null;
    dbgSession.paused = true;
    sim.call("addrOfLine", { line }).then((addr) => {
      if (addr) debugCommand("C", { tempAddr: addr, tempMode: 2 });
      else onDebugPaused(state);
    });
    return;
  }
  Object.assign(dbgSession, { paused: true, line: state.line, ip: state.regs.ip, inst: state.inst, regs: state.regs });
  lastModule = true;
  populateRegisters(state.regs);
  renderSpeicher();
  if (state.lastLine) {
    setPcLine(state.lastLine);
    status(`paused after line ${state.lastLine} — next #${state.regs.ip}`);
  } else {
    // Nothing executed yet: show where the program will start.
    setPcLine(state.line, "next");
    status(`ready at line ${state.line || "?"} (#${state.regs.ip})`);
  }
  updateRunButton();
}

/* current-line marker */
let pcHandle = null;
function setPcLine(line, kind = "done") {
  if (pcHandle) {
    editor.removeLineClass(pcHandle, "background", "cm-debug-line");
    editor.removeLineClass(pcHandle, "background", "cm-debug-next");
    editor.setGutterMarker(pcHandle, "pc", null);
    pcHandle = null;
  }
  if (!line || line > editor.lineCount()) return;
  pcHandle = editor.getLineHandle(line - 1);
  editor.addLineClass(pcHandle, "background", kind === "next" ? "cm-debug-next" : "cm-debug-line");
  const m = document.createElement("span");
  m.className = "pc-marker" + (kind === "next" ? " next" : "");
  // An SVG triangle: the "▶" character is drawn as an emoji on some systems
  // and then ignores the colour.
  m.innerHTML = '<svg viewBox="0 0 10 12" width="10" height="12" aria-hidden="true"><path d="M1 1 L9 6 L1 11 Z"/></svg>';
  m.title = kind === "next" ? "The program starts here" : "Last executed instruction";
  editor.setGutterMarker(pcHandle, "pc", m);
  editor.scrollIntoView({ line: line - 1, ch: 0 }, 60);
}

/* breakpoints: gutter markers move with the text while editing */
function breakpointLines() {
  const lines = [];
  if (!editor) return lines;
  editor.eachLine((h) => {
    if (h.gutterMarkers && h.gutterMarkers.breakpoints) lines.push(editor.getLineNumber(h) + 1);
  });
  return lines;
}

function setBreakpointMarker(line0, on) {
  let m = null;
  if (on) {
    m = document.createElement("span");
    m.className = "bp-marker";
    m.title = "Breakpoint (click or F9 to remove)";
    m.textContent = "●";
  }
  editor.setGutterMarker(line0, "breakpoints", m);
}

function toggleBreakpoint(line0) {
  const info = editor.lineInfo(line0);
  if (!info) return;
  setBreakpointMarker(line0, !(info.gutterMarkers && info.gutterMarkers.breakpoints));
  breakpointsChanged();
}

function applyBreakpointMarkers(lines) {
  editor.clearGutter("breakpoints");
  for (const l of lines || []) if (l >= 1 && l <= editor.lineCount()) setBreakpointMarker(l - 1, true);
  renderBreakpointsPanel();
}

function breakpointsChanged() {
  if (tabs[activeTab]) tabs[activeTab].breakpoints = breakpointLines();
  renderBreakpointsPanel();
  scheduleSessionSave();
  if (dbgSession) sim.call("breakpoints", { lines: breakpointLines() }).catch(() => {});
}

function renderBreakpointsPanel() {
  const list = $("bp-list");
  if (!list || !editor) return;
  const lines = breakpointLines();
  list.textContent = "";
  if (!lines.length) {
    list.innerHTML = '<div class="regs-empty">No breakpoints. Click left of a line number (or press F9) to add one.</div>';
    return;
  }
  const name = tabs[activeTab] ? tabs[activeTab].name : "";
  for (const l of lines) {
    const row = document.createElement("div");
    row.className = "bp-row";
    const dot = Object.assign(document.createElement("span"), { className: "bp-marker", textContent: "●" });
    const where = Object.assign(document.createElement("span"), { className: "bp-where", textContent: `${name}:${l}` });
    const src = Object.assign(document.createElement("span"), { className: "bp-src", textContent: editor.getLine(l - 1).trim() });
    const del = Object.assign(document.createElement("button"), { className: "dock-tab-close", textContent: "×", title: "Remove breakpoint" });
    del.onclick = (e) => { e.stopPropagation(); setBreakpointMarker(l - 1, false); breakpointsChanged(); };
    row.onclick = () => { editor.setCursor({ line: l - 1, ch: 0 }); editor.scrollIntoView({ line: l - 1, ch: 0 }, 60); editor.focus(); };
    row.append(dot, where, src, del);
    list.appendChild(row);
  }
}

function filterDebugSimText(text) {
  // Keep mmix-sim's trace of executed instructions; drop its prompts and
  // the statistics it prints at every stop.
  dbgCarry += text;
  const lines = dbgCarry.split("\n");
  dbgCarry = lines.pop();
  return lines
    .map((l) => l.replace(/mmix> /g, ""))
    .filter((l) => l.trim() && !/^\s*\d+ instructions?, /.test(l) && !/^\s*\((now|halted) at location/.test(l) && !/^\s*\.{20,}\s*$/.test(l))
    .map((l) => l + "\n")
    .join("");
}
let dbgCarry = "";

/* ---------- symbol table (from the mmixal listing) ---------- */
// Listing ends with lines like " Main = #0000000000000100 (1)" or
// " argv = $1 (2)". Addresses can be typed into Memory's Go to box by name.
let symbols = new Map(); // name -> { value: "#..." | "$n", addr: BigInt | null }

function parseSymbols(listing) {
  const map = new Map();
  if (!listing) return map;
  const at = listing.indexOf("Symbol table:");
  if (at < 0) return map;
  for (const line of listing.slice(at).split(/\r?\n/).slice(1)) {
    const m = /^\s*(\S+) = (#[0-9a-fA-F]+|\$\d+)/.exec(line);
    if (!m) continue;
    const value = m[2];
    map.set(m[1], { value, addr: value.startsWith("#") ? BigInt("0x" + value.slice(1)) : null });
  }
  return map;
}

function renderSymbols() {
  const list = $("symbol-list");
  if (!list) return;
  list.textContent = "";
  if (!symbols.size) {
    list.innerHTML = '<div class="regs-empty">Assemble the program to see its symbol table.</div>';
    return;
  }
  const rows = [...symbols].sort((a, b) => a[0].localeCompare(b[0]));
  for (const [name, s] of rows) {
    const row = document.createElement("div");
    row.className = "bp-row";
    const n = Object.assign(document.createElement("span"), { className: "sym-name", textContent: name });
    const v = Object.assign(document.createElement("span"), { className: "sym-val", textContent: s.value });
    row.title = s.addr != null ? "Show in the source and in Memory" : "Show in the source";
    row.onclick = () => {
      // Jump to the defining line ("name" in the label column).
      const re = new RegExp("^" + name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(\\s|$)");
      for (let i = 0; i < editor.lineCount(); i++) {
        if (re.test(editor.getLine(i))) {
          editor.setCursor({ line: i, ch: 0 });
          editor.scrollIntoView({ line: i, ch: 0 }, 60);
          break;
        }
      }
      if (s.addr != null) {
        currentSpeicherAddr = s.addr;
        showPanel("panel-memory");
        renderSpeicher();
      }
    };
    row.append(n, v);
    list.appendChild(row);
  }
}

function debugBreak() {
  if (dbgSession && !dbgSession.paused) {
    status("breaking…");
    sim.call("breakExec").catch(() => {});
  }
}

function showHelp(anchor) {
  Dock.show("panel-help");
  if (anchor) {
    const t = document.querySelector("#help-content " + anchor);
    if (t) t.scrollIntoView({ block: "start" });
  }
}

/* ---------- editor font size ---------- */
const EDITOR_FONT = { min: 10, max: 32, def: 16 };
let editorFontSize = EDITOR_FONT.def;

function setEditorFontSize(n, save = true) {
  editorFontSize = Math.max(EDITOR_FONT.min, Math.min(EDITOR_FONT.max, Math.round(n)));
  document.documentElement.style.setProperty("--editor-font-size", editorFontSize + "px");
  $("editor-font-size").textContent = editorFontSize;
  $("btn-font-down").disabled = editorFontSize <= EDITOR_FONT.min;
  $("btn-font-up").disabled = editorFontSize >= EDITOR_FONT.max;
  if (editor) editor.refresh();
  if (save) scheduleSessionSave();
}

/* ---------- code formatter ---------- */
// Lines up MMIXAL into the editor's column stops: label at column 0, opcode
// at 10, operands at 20, comment at 40 (roomy, like MMIXVD's examples). Fields are whitespace separated; the
// operand field may contain spaces only inside "strings" or 'c'haracters.
// Column stops shared by Format and the Tab key.
const COLUMN_STOPS = [10, 20, 40];
const FMT_COLS = { op: COLUMN_STOPS[0], args: COLUMN_STOPS[1], comment: COLUMN_STOPS[2] };

function formatMmixalLine(line) {
  const text = line.replace(/\s+$/, "");
  if (!text.trim()) return "";
  // MMIXAL treats a line as a comment unless it starts with a symbol
  // character, a digit or white space. Leave those (and indented comments) alone.
  if (!/^[\sA-Za-z0-9_:@]/.test(text)) return text;
  let i = 0;
  const skipWs = () => { while (i < text.length && /\s/.test(text[i])) i++; };
  const word = () => {
    const start = i;
    while (i < text.length && !/\s/.test(text[i])) i++;
    return text.slice(start, i);
  };
  const operands = () => {
    const start = i;
    let quote = null;
    while (i < text.length) {
      const c = text[i];
      if (quote) { if (c === quote) quote = null; }
      else if (c === '"' || c === "'") quote = c;
      else if (/\s/.test(c)) break;
      i++;
    }
    return text.slice(start, i);
  };
  const isComment = () => /^(%|\/\/)/.test(text.slice(i));
  const label = /\s/.test(text[0]) ? "" : word();
  skipWs();
  if (!label && /^([%*]|\/\/)/.test(text.slice(i))) return text; // indented comment line
  const op = isComment() ? "" : word();
  skipWs();
  const args = op && !isComment() ? operands() : "";
  skipWs();
  const comment = text.slice(i);
  let out = label;
  const to = (col) => { out += out.length < col ? " ".repeat(col - out.length) : " "; };
  if (op) { to(FMT_COLS.op); out += op; }
  if (args) { to(FMT_COLS.args); out += args; }
  if (comment) { to(op || args ? FMT_COLS.comment : FMT_COLS.op); out += comment; }
  return out;
}

function formatSource() {
  if (!editor || editor.getOption("readOnly")) {
    status("can't format while debugging", true);
    return;
  }
  const before = editor.getValue();
  const after = before.split("\n").map(formatMmixalLine).join("\n");
  if (after === before) { status("already formatted"); return; }
  const cur = editor.getCursor();
  const scroll = editor.getScrollInfo();
  // One undoable edit (Ctrl+Z restores the original).
  editor.operation(() => {
    editor.replaceRange(after, { line: 0, ch: 0 }, { line: editor.lastLine(), ch: editor.getLine(editor.lastLine()).length });
  });
  editor.setCursor({ line: cur.line, ch: Math.min(cur.ch, editor.getLine(cur.line).length) });
  editor.scrollTo(scroll.left, scroll.top);
  status("formatted");
}

/* ---------- friendlier assembler errors ---------- */
// mmixal reports a misspelt label as "YZ field is undefined!" or
// "undefined symbol: X". Find the names on those lines that the program never
// defines and suggest the closest label that it does define.
const MMIXAL_PREDEFINED = new Set([
  "Halt", "Fopen", "Fclose", "Fread", "Fgets", "Fgetws", "Fwrite", "Fputs", "Fputws", "Fseek", "Ftell",
  "StdIn", "StdOut", "StdErr", "TextRead", "TextWrite", "BinaryRead", "BinaryWrite", "BinaryReadWrite",
  "Text_Segment", "Data_Segment", "Pool_Segment", "Stack_Segment", "ROUND_CURRENT", "ROUND_OFF",
  "ROUND_UP", "ROUND_DOWN", "ROUND_NEAR", "Inf",
]);

function editDistance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

function undefinedSymbolHints(src, stderr) {
  if (!/undefined/i.test(stderr)) return [];
  const lines = src.split("\n");
  // Labels defined in the source: the first field of a line (also "X IS ...").
  const defined = new Map();
  lines.forEach((l, i) => {
    const m = /^([A-Za-z_:][\w:]*)/.exec(l);
    if (m && !defined.has(m[1])) defined.set(m[1], i + 1);
  });
  const isKnown = (name) => defined.has(name) || MMIXAL_PREDEFINED.has(name) || /^r[A-Z]{1,2}$/.test(name) || /^\d+[HBF]$/.test(name);
  const hints = [];
  const seen = new Set();
  const suggest = (name, where) => {
    if (seen.has(name) || isKnown(name)) return;
    seen.add(name);
    let best = null, bestD = 3;
    for (const [d, line] of defined) {
      const dist = editDistance(name.toLowerCase(), d.toLowerCase());
      if (dist < bestD) { bestD = dist; best = [d, line]; }
    }
    hints.push(`${where} uses "${name}", but no label with that name is defined.` +
      (best ? ` Did you mean "${best[0]}" (line ${best[1]})?` : " Define it as a label in the first column, or check the spelling."));
  };
  // "undefined symbol: Name" (reported at the end, without a line)
  for (const m of stderr.matchAll(/undefined symbol: ([\w:]+)/g)) suggest(m[1], "The program");
  // "line N: ... is undefined!" -> look at the names in that line's operands
  for (const m of stderr.matchAll(/line (\d+):[^\n]*undefined/g)) {
    const text = (lines[+m[1] - 1] || "").replace(/"(?:[^"\\]|\\.)*"|'.'/g, "");
    const fields = text.trim().split(/\s+/);
    const operands = /^\s/.test(text) ? fields[1] : fields[2]; // label? opcode operands
    const names = (operands || "").replace(/#[0-9A-Fa-f]+/g, "").match(/[A-Za-z_:][\w:]*/g) || []; // drop hex constants
    for (const name of names) suggest(name, `Line ${m[1]}`);
  }
  return hints;
}

/* ---------- Dock layout ---------- */
// Default layout, loosely after MMIXVD: editor top-left, console + input and
// memory below it, the register panes stacked on the right.
const DEFAULT_LAYOUT = {
  type: "row", sizes: [0.72, 0.28], children: [
    { type: "col", sizes: [0.58, 0.42], children: [
      { type: "stack", panels: ["panel-editor"] },
      { type: "row", sizes: [0.5, 0.5], children: [
        { type: "col", sizes: [0.7, 0.3], children: [
          { type: "stack", panels: ["panel-output", "panel-asm", "panel-breakpoints", "panel-symbols", "panel-files"] },
          { type: "stack", panels: ["panel-input"] },
        ] },
        { type: "stack", panels: ["panel-memory"] },
      ] },
    ] },
    { type: "col", sizes: [0.4, 0.25, 0.35], children: [
      { type: "stack", panels: ["panel-regs-local"] },
      { type: "stack", panels: ["panel-regs-global"] },
      { type: "stack", panels: ["panel-regs-special"] },
    ] },
  ],
};
// Phones / narrow windows: three tabbed rows.
const NARROW_LAYOUT = {
  type: "col", sizes: [0.45, 0.3, 0.25], children: [
    { type: "stack", panels: ["panel-editor"] },
    { type: "stack", panels: ["panel-output", "panel-input", "panel-asm", "panel-memory", "panel-breakpoints", "panel-symbols", "panel-files"] },
    { type: "stack", panels: ["panel-regs-local", "panel-regs-global", "panel-regs-special"] },
  ],
};

function initLayout() {
  let t = null;
  Dock.init({
    root: $("dock-root"),
    store: $("panel-store"),
    overlay: $("dock-overlay"),
    ghost: $("dock-ghost"),
    storageKey: "mmix-layout-v1",
    layout: DEFAULT_LAYOUT,
    narrowLayout: NARROW_LAYOUT,
    onLayout: (live) => {
      if (editor) editor.refresh();
      clearTimeout(t);
      t = setTimeout(() => { renderSpeicher(); renderViewMenu(); }, live ? 80 : 0);
    },
  });
  window.addEventListener("resize", () => { if (editor) editor.refresh(); });
  initViewMenu();
}

function showPanel(id) {
  Dock.activate(id);
}

function initViewMenu() {
  const btn = $("btn-view"), menu = $("view-menu");
  const close = () => { menu.hidden = true; btn.setAttribute("aria-expanded", "false"); };
  btn.onclick = (e) => {
    e.stopPropagation();
    renderViewMenu();
    menu.hidden = !menu.hidden;
    btn.setAttribute("aria-expanded", String(!menu.hidden));
  };
  document.addEventListener("pointerdown", (e) => {
    if (!menu.hidden && !menu.contains(e.target) && !btn.contains(e.target)) close();
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
}

function renderViewMenu() {
  const menu = $("view-menu");
  if (!menu || !window.Dock) return;
  menu.textContent = "";
  for (const p of Dock.panelList()) {
    const b = document.createElement("button");
    b.className = "menu-item";
    b.setAttribute("role", "menuitemcheckbox");
    b.setAttribute("aria-checked", String(p.visible));
    b.disabled = !p.closable;
    const check = document.createElement("span");
    check.className = "menu-check";
    check.textContent = p.visible ? "✓" : "";
    b.append(check, p.title);
    b.onclick = () => (p.visible ? Dock.hide(p.id) : Dock.show(p.id));
    menu.appendChild(b);
  }
  menu.appendChild(Object.assign(document.createElement("div"), { className: "menu-sep" }));
  const reset = document.createElement("button");
  reset.className = "menu-item";
  reset.append(Object.assign(document.createElement("span"), { className: "menu-check" }), "Reset layout");
  reset.onclick = () => Dock.reset();
  menu.appendChild(reset);
  menu.appendChild(Object.assign(document.createElement("div"), {
    className: "menu-hint",
    textContent: "Drag a panel's tab to move it. Drop it on another panel to add a tab, or on an edge to split.",
  }));
}

/* ---------- MMIXVD: Register Inspector ---------- */
// Three panels like MMIXVD: local $0..$L-1, global $G..$255, special rA..rZZ.
// Each keeps its own number system / unit size.
const REG_VIEWS = {
  local: { format: "hex", size: 8, empty: "No local registers in use (rL = 0)." },
  global: { format: "hex", size: 8, empty: "No global registers (rG = 256)." },
  special: { format: "hex", size: 8, filter: "active", empty: "" },
};

function initRegistersControls() {
  document.querySelectorAll(".regs-panel").forEach((panel) => {
    const kind = panel.dataset.regs;
    const view = REG_VIEWS[kind];
    panel.innerHTML = `
      <div class="reg-toolbar">
        <div class="seg" role="group" aria-label="Number system">
          <button class="mini-btn" data-radix="hex" title="Hexadecimal">Hex</button>
          <button class="mini-btn" data-radix="udec" title="Unsigned decimal">Dec</button>
          <button class="mini-btn" data-radix="sdec" title="Signed decimal (two's complement)">&plusmn;Dec</button>
          <button class="mini-btn" data-radix="float" title="IEEE 754 floating point (OCTA = double, TETRA = float)">Float</button>
          <button class="mini-btn" data-radix="ascii" title="Bytes as ASCII characters">ASCII</button>
        </div>
        <div class="seg" role="group" aria-label="Unit size">
          <button class="mini-btn" data-size="8" title="One 64-bit octabyte">OCTA</button>
          <button class="mini-btn" data-size="4" title="Two 32-bit tetrabytes">TETRA</button>
          <button class="mini-btn" data-size="2" title="Four 16-bit wydes">WYDE</button>
          <button class="mini-btn" data-size="1" title="Eight bytes">BYTE</button>
        </div>
        ${view.filter ? '<button class="mini-btn reg-filter" title="Show only non-zero special registers, or all 32">Non-zero</button>' : ""}
      </div>
      <div class="regs-list"><div class="regs-empty">Registers are shown here after the program runs.</div></div>`;
    const radixBtns = panel.querySelectorAll("[data-radix]");
    const sizeBtns = panel.querySelectorAll("[data-size]");
    const filterBtn = panel.querySelector(".reg-filter");
    const sync = () => {
      radixBtns.forEach((b) => b.classList.toggle("active", b.dataset.radix === view.format));
      sizeBtns.forEach((b) => {
        const n = Number(b.dataset.size);
        b.classList.toggle("active", n === view.size);
        // Floating point only exists for 64-bit (double) and 32-bit (float) units
        b.disabled = view.format === "float" && n < 4;
      });
      if (filterBtn) {
        filterBtn.classList.toggle("active", view.filter === "active");
        filterBtn.textContent = view.filter === "active" ? "Non-zero" : "All 32";
      }
    };
    radixBtns.forEach((b) => (b.onclick = () => {
      view.format = b.dataset.radix;
      if (view.format === "float" && view.size < 4) view.size = 4;
      sync();
      renderRegisters(kind);
    }));
    sizeBtns.forEach((b) => (b.onclick = () => {
      view.size = Number(b.dataset.size);
      sync();
      renderRegisters(kind);
    }));
    if (filterBtn) filterBtn.onclick = () => {
      view.filter = view.filter === "active" ? "all" : "active";
      sync();
      renderRegisters(kind);
    };
    sync();
  });
}

// MMIXware's special_reg enum: g[0..31] hold these, in this order.
const SPECIAL_REGS = [
  "rB", "rD", "rE", "rH", "rJ", "rM", "rR", "rBB",
  "rC", "rN", "rO", "rS", "rI", "rT", "rTT", "rK", "rQ", "rU", "rV", "rG", "rL",
  "rA", "rF", "rP", "rW", "rX", "rY", "rZ", "rWW", "rXX", "rYY", "rZZ",
];
const R = Object.fromEntries(SPECIAL_REGS.map((n, i) => [n, i]));

let regData = { local: [], global: [], special: [] };

// `snap` comes from the worker: { ip, g: [256 hex], locals: [hex] }.
function populateRegisters(snap) {
  const big = (h) => BigInt("0x" + h);
  const g = (i) => big(snap.g[i]);

  const special = [{ name: "@", title: "inst_ptr — address of the next instruction", val: big(snap.ip) }];
  SPECIAL_REGS.forEach((name, i) => special.push({ name, val: g(i) }));

  const G = Number(g(R.rG) & 0xffn);
  const L = Number(g(R.rL) & 0xffn);
  const global = [];
  for (let k = Math.max(32, G); k <= 255; k++) global.push({ name: "$" + k, val: g(k) });

  const local = snap.locals.map((h, k) => ({ name: "$" + k, val: big(h) }));

  for (const list of [special, global, local]) {
    for (const item of list) {
      const key = (list === special ? "s:" : "r:") + item.name;
      const prev = prevRegMap.get(key);
      item.changed = prev !== undefined && prev !== item.val;
      item.prev = prev;
      prevRegMap.set(key, item.val);
    }
  }
  regData = { local, global, special };

  // Plain-text dump for tools/browser-test.js
  const hex = (v) => "0x" + v.toString(16).padStart(16, "0");
  const lines = ["inst_ptr = " + hex(special[0].val), "", "rL = " + L + ", rG = " + G, ""];
  for (const r of [...local, ...global, ...special.slice(1)]) lines.push(r.name.padEnd(5) + " = " + hex(r.val));
  $("reg-output").textContent = lines.join("\n");

  renderRegisters();
}

// Split a 64-bit value into big-endian units of `size` bytes.
function regUnits(val, size) {
  const bits = BigInt(size * 8);
  const mask = (1n << bits) - 1n;
  const out = [];
  for (let i = 8 / size - 1; i >= 0; i--) out.push((val >> (bits * BigInt(i))) & mask);
  return out;
}

const DEC_WIDTH = { 8: 20, 4: 10, 2: 5, 1: 3 }; // digits of 2^(8n)-1

// One unit -> fixed-width list of cells { ch, dim } so all rows line up (MMIXVD style).
function regCells(u, size, format) {
  const cells = [];
  const pushPadded = (str, width, signed) => {
    if (signed) {
      const neg = str.startsWith("-");
      if (neg) str = str.slice(1);
      cells.push({ ch: neg ? "-" : "+", dim: !neg });
    }
    const padded = str.padStart(width, "0");
    // Leading zeros are dimmed; a unit that is entirely zero is dimmed as a
    // whole (no single "0" left standing out).
    let lead = true;
    for (let i = 0; i < padded.length; i++) {
      if (lead && padded[i] !== "0") lead = false;
      cells.push({ ch: padded[i], dim: lead });
    }
  };
  switch (format) {
    case "udec":
      pushPadded(u.toString(10), DEC_WIDTH[size], false);
      break;
    case "sdec":
      pushPadded(BigInt.asIntN(size * 8, u).toString(10), DEC_WIDTH[size] - (size === 8 ? 1 : 0), true);
      break;
    case "ascii":
      for (let i = size - 1; i >= 0; i--) {
        const c = Number((u >> BigInt(i * 8)) & 0xffn);
        const printable = c >= 0x20 && c < 0x7f;
        cells.push({ ch: printable ? String.fromCharCode(c) : "·", dim: !printable });
      }
      break;
    case "float": {
      const dv = new DataView(new ArrayBuffer(8));
      let f;
      if (size === 8) { dv.setBigUint64(0, u); f = dv.getFloat64(0); }
      else { dv.setUint32(0, Number(u)); f = dv.getFloat32(0); }
      let txt;
      if (Number.isNaN(f)) txt = "NaN";
      else if (!Number.isFinite(f)) txt = f > 0 ? "+Inf" : "-Inf";
      else if (f === 0) txt = Object.is(f, -0) ? "-0.0" : "0.0";
      else {
        const a = Math.abs(f);
        const v = size === 8 ? f : Number(f.toPrecision(7));
        txt = a >= 1e15 || a < 1e-5 ? v.toExponential() : String(v);
      }
      return [{ ch: txt, dim: f === 0, text: true }];
    }
    default: // hex
      pushPadded(u.toString(16).toUpperCase(), size * 2, false);
  }
  return cells;
}

function clearRegisters(msg) {
  regData = { local: [], global: [], special: [] };
  document.querySelectorAll(".regs-panel .regs-list").forEach((c) => {
    c.innerHTML = `<div class="regs-empty">${msg}</div>`;
  });
}

function renderRegisters(only) {
  if (!lastModule) return;
  for (const kind of only ? [only] : Object.keys(REG_VIEWS)) {
    const panel = document.querySelector(`.regs-panel[data-regs="${kind}"]`);
    const container = panel && panel.querySelector(".regs-list");
    if (!container) continue;
    const view = REG_VIEWS[kind];
    container.dataset.radix = view.format;
    container.dataset.size = String(view.size);
    let list = regData[kind];
    if (kind === "special" && view.filter === "active") list = list.filter((r) => r.val !== 0n || r.name === "@");
    if (!list.length) {
      container.innerHTML = `<div class="regs-empty">${view.empty}</div>`;
      continue;
    }
    const esc = (c) => (c === " " ? "&nbsp;" : c.replace(/&/g, "&amp;").replace(/</g, "&lt;"));
    let html = "";
    for (const item of list) {
      const signed = BigInt.asIntN(64, item.val);
      const tip = (item.title || item.name) + "  #" + item.val.toString(16).toUpperCase().padStart(16, "0") +
        " = " + item.val.toString(10) + (signed < 0n ? " (signed " + signed.toString(10) + ")" : "");
      html += `<div class="reg-row${kind === "special" ? " special" : ""}${item.changed ? " changed" : ""}">` +
        `<span class="reg-name">${item.name}</span><span class="reg-val" title="${tip}">`;
      // Highlight only the units (tetras, wydes, bytes) whose value changed.
      const before = item.changed ? regUnits(item.prev, view.size) : null;
      for (const [k, u] of regUnits(item.val, view.size).entries()) {
        html += `<span class="reg-unit${before && before[k] !== u ? " unit-changed" : ""}">`;
        for (const c of regCells(u, view.size, view.format)) {
          html += `<span class="rc${c.text ? " rc-text" : ""}${c.dim ? " dim" : ""}">${esc(c.ch)}</span>`;
        }
        html += "</span>";
      }
      html += "</span></div>";
    }
    container.innerHTML = html;
  }
}

/* ---------- MMIXVD: Speicher (Memory Viewer) ---------- */
function parseAddress(str) {
  const s = (str || "").trim().toLowerCase();
  const sym = symbols.get((str || "").trim());
  if (sym && sym.addr != null) return sym.addr;
  const named = { text_segment: 0n, text: 0x100n, data_segment: 0x2000000000000000n, data: 0x2000000000000000n,
    pool_segment: 0x4000000000000000n, pool: 0x4000000000000000n,
    stack_segment: 0x6000000000000000n, stack: 0x6000000000000000n, code: 0x100n };
  if (!s) return 0x100n;
  if (named[s] !== undefined) return named[s];
  try {
    const v = s.startsWith("#") ? BigInt("0x" + s.slice(1)) : BigInt(s);
    return v < 0n ? 0n : v & 0xffffffffffffffffn;
  } catch (e) {
    status("not an address: " + str, true);
    return currentSpeicherAddr;
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
    const step = speicherPageBytes();
    currentSpeicherAddr = currentSpeicherAddr >= step ? currentSpeicherAddr - step : 0n;
    $("mem-addr").value = "0x" + currentSpeicherAddr.toString(16).padStart(16, "0");
    renderSpeicher();
  };
  $("btn-mem-next").onclick = () => {
    currentSpeicherAddr += speicherPageBytes();
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

// How many 16- or 8-byte rows fit into the Speicher pane right now.
function speicherGeometry() {
  const container = $("speicher-dump");
  if (!speicherGeometry.charW) {
    const probe = document.createElement("span");
    probe.textContent = "0".repeat(100);
    probe.style.cssText = "position:absolute;visibility:hidden;white-space:pre";
    container.appendChild(probe);
    speicherGeometry.charW = probe.getBoundingClientRect().width / 100 || 7.2;
    speicherGeometry.lineH = parseFloat(getComputedStyle(container).lineHeight) || 18;
    probe.remove();
  }
  const charW = speicherGeometry.charW, lineH = speicherGeometry.lineH;
  const w = Math.max(0, container.clientWidth - 20);
  const h = Math.max(0, container.clientHeight - 12);
  // characters per row at 16 bytes/row: "addr16: " + body
  const need16 = { hexascii: 18 + 49 + 1 + 16, ascii: 18 + 16, octa: 18 + 2 * 20 }[speicherMode];
  const bpr = w >= need16 * charW || speicherMode === "ascii" ? 16 : 8;
  const rows = Math.max(4, Math.min(64, Math.floor(h / lineH) || 4));
  return { bpr, rows, bytes: bpr * rows };
}

let speicherSeq = 0;
async function renderSpeicher() {
  const container = $("speicher-dump");
  if (!lastModule) {
    container.innerHTML = '<div class="speicher-empty">Memory is shown here after the program runs.</div>';
    return;
  }
  const { bpr, rows, bytes: pageBytes } = speicherGeometry();
  const base = currentSpeicherAddr & ~BigInt(bpr - 1);
  $("mem-addr").value = "0x" + base.toString(16).padStart(16, "0");

  // Clamp so the page never runs past the top of the address space.
  const maxRows = Number(((0xffffffffffffffffn - base) / BigInt(bpr)) + 1n);
  const nRows = Math.min(rows, maxRows);
  const my = ++speicherSeq;
  let bytes;
  try {
    bytes = await sim.call("mem", { addr: base.toString(16), count: nRows * bpr });
  } catch (e) {
    return; // worker stopped or restarted meanwhile
  }
  if (my !== speicherSeq || !bytes) return; // a newer render superseded this one
  const readByteRow = (rowAddr) => {
    const off = Number(rowAddr - base);
    return Array.from(bytes.subarray(off, off + bpr));
  };
  const hx = (b) => b.toString(16).padStart(2, "0");
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const asc = (b) => (b >= 32 && b <= 126 ? String.fromCharCode(b) : "·");

  let html = "";
  for (let r = 0; r < nRows; r++) {
    const rowAddr = base + BigInt(r * bpr);
    const b = readByteRow(rowAddr);
    const addr = `<span class="speicher-addr">${rowAddr.toString(16).padStart(16, "0")}</span>`;
    const z = (s, byte) => (byte === 0 ? `<span class="dim">${s}</span>` : s);
    let body;
    if (speicherMode === "ascii") {
      body = `<span class="speicher-ascii">${b.map((x) => z(esc(asc(x)), x)).join("")}</span>`;
    } else if (speicherMode === "octa") {
      // Each octa as two tetras ("e3010005 e3020002"), zero bytes dimmed.
      const tetra = (i) => `<span class="tetra">${b.slice(i, i + 4).map((x) => z(hx(x), x)).join("")}</span>`;
      let octas = "";
      for (let i = 0; i < b.length; i += 8) octas += `<span class="speicher-octa">${tetra(i)}${tetra(i + 4)}</span>`;
      body = `<span class="speicher-bytes">${octas}</span>`;
    } else {
      const half = bpr / 2;
      const hexs = b.map((x, i) => z(hx(x), x) + (i === half - 1 ? "  " : " ")).join("");
      body = `<span class="speicher-bytes">${hexs}</span> <span class="speicher-ascii">${b.map((x) => z(esc(asc(x)), x)).join("")}</span>`;
    }
    html += `<div class="speicher-line">${addr}: ${body}</div>`;
  }
  container.innerHTML = html;
  $("mem-result").textContent = `${pageBytes} bytes @ #${base.toString(16)}`;
}

function speicherPageBytes() {
  return BigInt(lastModule ? speicherGeometry().bytes : 64);
}

/* ---------- open file (Ctrl+O) ---------- */
let lastRunFiles = null; // files created by the last run, for the Files panel

// Opens source text in the editor: reuses the current tab if it is empty or
// unmodified, otherwise opens a new tab so no edits are lost.
function openSourceFile(name, text, handle = null) {
  if (blockedByDebug()) return;
  saveActiveTab();
  const cur = tabs[activeTab];
  // Reuse only an empty tab or an untouched example; anything else stays open.
  const reusable = !cur || !cur.content.trim() || (cur.content === cur.loaded && cur.fromExample);
  if (!reusable) newTab(name);
  const t = tabs[activeTab];
  Object.assign(t, { name, stem: name.replace(/\.mms$/i, "") || "prog", breakpoints: [], fromExample: false,
    mmo: null, assembledSrc: null, listing: null, handle });
  currentStem = t.stem;
  currentMmo = null;
  currentListing = null;
  $("btn-download-mmo").disabled = true;
  $("btn-download-lst").disabled = true;
  setEditorContent(text);
  t.loaded = t.content;
  renderTabs();
  status("opened " + name);
}

async function openFileDialog() {
  // Chrome / Edge: the file handle is kept, so Ctrl+S saves back to that file.
  if (window.showOpenFilePicker) {
    try {
      const [h] = await window.showOpenFilePicker({
        types: [{ description: "MMIXAL source", accept: { "text/plain": [".mms", ".txt"] } }],
      });
      const f = await h.getFile();
      openSourceFile(f.name, await f.text(), h);
      return;
    } catch (e) {
      if (e && e.name === "AbortError") return;
      // otherwise fall back to the plain file input
    }
  }
  $("open-input").click();
}

// Hand a Blob to the browser as a download. The URL is revoked a little
// later: revoking right after click() can cancel the download.
function downloadBlob(name, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ---------- save file (Ctrl+S) ---------- */
// Chrome/Edge: a real "Save as" dialog via the File System Access API; later
// Ctrl+S in the same tab writes to the same file. Other browsers: download.
async function saveFile(saveAs = false) {
  saveActiveTab();
  const tab = tabs[activeTab];
  const text = editor.getValue();
  const name = /\.mms$/i.test(tab.name) ? tab.name : tab.name + ".mms";
  if (window.showSaveFilePicker) {
    try {
      let handle = saveAs ? null : tab.handle;
      if (!handle) {
        handle = await window.showSaveFilePicker({
          suggestedName: name,
          types: [{ description: "MMIXAL source", accept: { "text/plain": [".mms"] } }],
        });
      }
      const w = await handle.createWritable();
      await w.write(text);
      await w.close();
      tab.handle = handle;
      if (handle.name !== tab.name) {
        tab.name = handle.name;
        tab.stem = handle.name.replace(/\.mms$/i, "") || "prog";
        currentStem = tab.stem;
        renderTabs();
      }
      status("saved " + handle.name);
      return;
    } catch (e) {
      if (e && e.name === "AbortError") { status("save cancelled"); return; }
      // e.g. blocked in an iframe: fall back to a plain download
    }
  }
  downloadBlob(name, new Blob([text], { type: "text/plain" }));
  status("downloaded " + name);
}

/* ---------- session persistence ---------- */
// Open files, input, options and view settings survive a reload.
// (The panel layout is saved separately by dock.js, the theme as "mmix-theme".)
const SESSION_KEY = "mmix-session-v1";
let sessionTimer = null;
let sessionRestoring = false;
let sessionSaveWarned = false;

function scheduleSessionSave() {
  if (sessionRestoring) return;
  clearTimeout(sessionTimer);
  sessionTimer = setTimeout(saveSession, 400);
}

function saveSession() {
  clearTimeout(sessionTimer);
  if (!editor || sessionRestoring) return;
  saveActiveTab();
  const data = {
    v: 1,
    tabs: tabs.map((t) => ({ name: t.name, stem: t.stem, content: t.content, loaded: t.loaded, breakpoints: t.breakpoints || [], fromExample: !!t.fromExample })),
    activeTab,
    stdin: $("stdin").value,
    opts: Object.fromEntries(["trace", "profile", "stats", "autorun"].map((k) => [k, $("opt-" + k).checked])),
    regViews: REG_VIEWS,
    memory: { mode: speicherMode, addr: currentSpeicherAddr.toString(16) },
    editorFont: editorFontSize,
  };
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(data));
    sessionSaveWarned = false;
  } catch (e) {
    // Storage full or blocked: say so once instead of losing the files silently.
    if (!sessionSaveWarned) status("could not save your open files in the browser (storage full?) — use Ctrl+S", true);
    sessionSaveWarned = true;
  }
}

// Returns true if a previous session was restored.
function restoreSession() {
  let data = null;
  try { data = JSON.parse(localStorage.getItem(SESSION_KEY) || "null"); } catch (e) { data = null; }
  if (!data || data.v !== 1 || !Array.isArray(data.tabs) || !data.tabs.length) return false;
  sessionRestoring = true;
  try {
    tabs = data.tabs.map((t) => ({
      name: String(t.name || "untitled.mms"),
      stem: String(t.stem || "prog"),
      content: String(t.content || ""),
      loaded: t.loaded == null ? undefined : String(t.loaded),
      fromExample: !!t.fromExample,
      breakpoints: Array.isArray(t.breakpoints) ? t.breakpoints.filter((n) => Number.isInteger(n) && n > 0) : [],
      mmo: null, listing: null, assembledSrc: null,
    }));
    activeTab = Math.min(Math.max(0, data.activeTab | 0), tabs.length - 1);
    currentStem = tabs[activeTab].stem;
    currentMmo = null;
    currentListing = null;
    setEditorContent(tabs[activeTab].content);
    if (typeof data.stdin === "string") $("stdin").value = data.stdin;
    for (const [k, v] of Object.entries(data.opts || {})) {
      const el = $("opt-" + k);
      if (el) el.checked = !!v;
    }
    for (const kind of Object.keys(REG_VIEWS)) {
      const v = data.regViews && data.regViews[kind];
      if (!v) continue;
      if (["hex", "udec", "sdec", "float", "ascii"].includes(v.format)) REG_VIEWS[kind].format = v.format;
      if ([1, 2, 4, 8].includes(v.size)) REG_VIEWS[kind].size = v.size;
      if (REG_VIEWS[kind].filter && (v.filter === "all" || v.filter === "active")) REG_VIEWS[kind].filter = v.filter;
    }
    if (Number.isFinite(data.editorFont)) setEditorFontSize(data.editorFont, false);
    const m = data.memory || {};
    if (["hexascii", "ascii", "octa"].includes(m.mode)) {
      speicherMode = m.mode;
      for (const mode of ["hexascii", "ascii", "octa"]) $("btn-mem-mode-" + mode).classList.toggle("active", mode === m.mode);
    }
    try { if (m.addr) currentSpeicherAddr = BigInt("0x" + m.addr); } catch (e) { /* keep default */ }
    $("mem-addr").value = "0x" + currentSpeicherAddr.toString(16).padStart(16, "0");
    if ($("examples").querySelector(`option[value="${CSS.escape(tabs[activeTab].name)}"]`)) $("examples").value = tabs[activeTab].name;
    return true;
  } finally {
    sessionRestoring = false;
  }
}

function initSessionPersistence() {
  editor.on("change", scheduleSessionSave);
  // Text fields and checkboxes, plus the register / memory view buttons.
  // (Tabs, breakpoints and font size schedule their own saves.)
  document.addEventListener("input", scheduleSessionSave, true);
  document.addEventListener("change", scheduleSessionSave, true);
  document.addEventListener("click", (e) => {
    if (e.target.closest && e.target.closest(".reg-toolbar, .speicher-toolbar")) scheduleSessionSave();
  }, true);
  window.addEventListener("pagehide", saveSession);
  document.addEventListener("visibilitychange", () => { if (document.hidden) saveSession(); });
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
  $("file-upload").onchange = async (e) => {
    for (const f of e.target.files) {
      if (/\.mms$/i.test(f.name)) openSourceFile(f.name, await f.text()); // source: into the editor
      else uploadedFiles.set(f.name, new Uint8Array(await f.arrayBuffer()));
    }
    e.target.value = "";
    listOutputFiles(lastRunFiles);
  };
  $("btn-open").onclick = openFileDialog;
  $("open-input").onchange = async (e) => {
    const f = e.target.files && e.target.files[0];
    if (f) openSourceFile(f.name, await f.text());
    e.target.value = "";
  };
  $("examples").onchange = () => loadExample($("examples").value);
  $("btn-new-tab").onclick = () => newTab();

  initLayout();

  // drag-and-drop .mms files into the editor
  const pane = $("panel-editor");
  pane.addEventListener("dragover", (e) => { e.preventDefault(); pane.classList.add("drag"); });
  pane.addEventListener("dragleave", () => pane.classList.remove("drag"));
  pane.addEventListener("drop", async (e) => {
    e.preventDefault();
    pane.classList.remove("drag");
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) openSourceFile(f.name, await f.text());
  });

  $("btn-assemble").onclick = assemble;
  $("btn-run").onclick = () => run();
  $("btn-download-mmo").onclick = () => {
    if (currentMmo) downloadBlob(currentStem + ".mmo", new Blob([currentMmo]));
  };
  $("btn-download-lst").onclick = () => {
    if (currentListing) downloadBlob(currentStem + ".lst", new Blob([currentListing], { type: "text/plain" }));
  };
  $("btn-share").onclick = async () => {
    // The link carries the program; the page's own URL stays clean.
    const url = location.origin + location.pathname + "#" + encodeProgram(editor.getValue());
    try { await navigator.clipboard.writeText(url); status("share link copied"); }
    catch (e) { window.prompt("Copy this share link:", url); }
  };

  defineMmixalMode();
  editor = CodeMirror.fromTextArea($("editor"), {
    mode: "mmixal",
    lineNumbers: true,
    gutters: ["breakpoints", "pc", "CodeMirror-linenumbers", "errors"],
    tabSize: 8,
    indentUnit: 8,
    extraKeys: {
      "Ctrl-Enter": assemble,
      "Cmd-Enter": assemble,
      "Shift-Ctrl-Enter": () => run(),
      "Shift-Cmd-Enter": () => run(),
      F5: () => (dbgSession ? debugContinue() : run()),
      F8: debugContinue,
      F9: (cm) => toggleBreakpoint(cm.getCursor().line),
      F10: debugOver,
      F11: debugStep,
      F7: debugStep,
      "Shift-F11": debugOut,
      "Ctrl-F10": runToCursor,
      "Shift-Alt-F": formatSource,
      "Ctrl-O": openFileDialog,
      "Cmd-O": openFileDialog,
      F6: debugBreak,
      F1: () => showHelp(),
      "Ctrl-S": () => saveFile(),
      "Cmd-S": () => saveFile(),
      "Shift-Ctrl-S": () => saveFile(true),
      "Shift-Cmd-S": () => saveFile(true),
      "Shift-F5": stopRun,
      Tab: (cm) => {
        if (cm.somethingSelected()) {
          cm.indentSelection("add");
          return;
        }
        const cursor = cm.getCursor();
        const col = cursor.ch;
        const STOPS = COLUMN_STOPS;
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
        const STOPS = [0, ...COLUMN_STOPS];
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
  initOpcodeTips(editor);
  editor.on("gutterClick", (cm, line, gutter) => {
    if (gutter === "breakpoints" || gutter === "pc" || gutter === "CodeMirror-linenumbers") toggleBreakpoint(line);
  });
  // Breakpoint markers move with edits; keep the panel in step.
  editor.on("changes", () => { if (editor.getOption("readOnly")) return; clearTimeout(bpTimer); bpTimer = setTimeout(breakpointsChanged, 300); });
  let bpTimer = null;

  const restored = restoreSession();
  const shared = decodeProgram(location.hash.slice(1));
  if (shared) {
    // A shared link opens in its own tab next to the restored files
    // (or switches to a tab that already holds exactly that program).
    const norm = shared.replace(/\r\n?/g, "\n");
    const same = restored ? tabs.findIndex((t) => t.content === norm) : -1;
    if (same >= 0) switchTab(same);
    else {
      if (restored) newTab("shared.mms");
      const t = tabs[activeTab];
      t.name = "shared.mms";
      t.stem = currentStem = "shared";
      setEditorContent(shared);
      t.loaded = t.content;
    }
    // Consumed: the program now lives in the saved session.
    try { history.replaceState(null, "", location.pathname + location.search); } catch (e) {}
  }
  renderTabs();
  initSessionPersistence();

  const isLight = localStorage.getItem("mmix-theme") === "light";
  applyTheme(isLight);
  $("btn-theme").onclick = () => applyTheme(!document.documentElement.classList.contains("light"));

  let autoTimer = null;
  editor.on("change", () => {
    if (suppressAutoRun || !$("opt-autorun").checked) return;
    clearTimeout(autoTimer);
    // Auto-run gets a time limit, so a half-typed loop can't keep running.
    autoTimer = setTimeout(() => run({ timeoutMs: 3000 }), 900);
  });
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "o") {
      e.preventDefault();
      if (!e.target.closest || !e.target.closest(".CodeMirror")) openFileDialog();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "s") {
      e.preventDefault();
      if (!e.target.closest || !e.target.closest(".CodeMirror")) saveFile(e.shiftKey);
      return;
    }
    if (e.target.closest && e.target.closest(".CodeMirror")) return; // editor keymap handles these
    const keys = {
      F5: () => (e.shiftKey ? stopRun() : dbgSession ? debugContinue() : run()),
      F7: debugStep, F8: debugContinue, F10: e.ctrlKey ? runToCursor : debugOver,
      F11: e.shiftKey ? debugOut : debugStep,
      F6: debugBreak,
      F1: () => showHelp(),
    };
    if (keys[e.key] && !e.metaKey && !e.altKey && (!e.ctrlKey || e.key === "F10")) { e.preventDefault(); keys[e.key](); }
  });

  initRegistersControls();
  initSpeicherControls();
  $("btn-stdin-clear").onclick = () => { $("stdin").value = ""; $("stdin").focus(); };
  if (window.ResizeObserver) {
    let t = null;
    new ResizeObserver(() => { clearTimeout(t); t = setTimeout(renderSpeicher, 60); }).observe($("speicher-dump"));
  }

  window.loadExample = loadExample;
  $("btn-stop").onclick = stopRun;
  $("btn-debug").onclick = () => debugStart();
  $("btn-step").onclick = debugStep;
  $("btn-over").onclick = debugOver;
  $("btn-out").onclick = debugOut;
  $("btn-continue").onclick = debugContinue;
  $("btn-break").onclick = debugBreak;
  $("btn-format").onclick = formatSource;
  $("btn-font-down").onclick = () => setEditorFontSize(editorFontSize - 1);
  $("btn-font-up").onclick = () => setEditorFontSize(editorFontSize + 1);
  // Ctrl + / Ctrl - / Ctrl 0 zoom the editor (like MMIXVD) when it has focus;
  // elsewhere they keep zooming the page as usual.
  editor.getWrapperElement().addEventListener("keydown", (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const k = e.key;
    if (k === "+" || k === "=") setEditorFontSize(editorFontSize + 1);
    else if (k === "-" || k === "_") setEditorFontSize(editorFontSize - 1);
    else if (k === "0") setEditorFontSize(EDITOR_FONT.def);
    else return;
    e.preventDefault();
    e.stopPropagation();
  }, true);
  $("btn-help").onclick = () => showHelp();
  renderHelp($("help-content"));
  $("btn-bp-clear").onclick = () => { editor.clearGutter("breakpoints"); breakpointsChanged(); };
  try {
    await sim.start();
  } catch (e) {
    status(String(e.message || e), true);
    return;
  }
  toolchainReady = true;
  $("btn-share").disabled = false;
  updateRunButton();
  status("toolchain ready");
  // A shared link (#...) carries its own program; don't replace it with hello.mms.
  if (!shared && !restored) await loadExample("hello.mms");
}

function encodeProgram(src) {
  try { return btoa(unescape(encodeURIComponent(src))); } catch (e) { return ""; }
}
function decodeProgram(hash) {
  try { return decodeURIComponent(escape(atob(hash))); } catch (e) { return ""; }
}

function applyTheme(light) {
  document.documentElement.classList.toggle("light", light);
  const btn = $("btn-theme");
  if (btn) {
    btn.textContent = light ? "☀️" : "🌙";
    btn.title = (light ? "Light" : "Dark") + " theme — click to switch";
  }
  try { localStorage.setItem("mmix-theme", light ? "light" : "dark"); } catch (e) {}
}

// `files`: [{ name, size }] created by the last run (null = no run yet).
function listOutputFiles(files) {
  const out = $("file-list");
  out.textContent = "";
  const line = (t) => out.appendChild(document.createTextNode(t + "\n"));
  const heading = (t) => out.appendChild(Object.assign(document.createElement("div"), { className: "files-heading", textContent: t }));
  heading("Data files given to the program");
  if (!uploadedFiles.size) line("(none — use Choose Files above)");
  for (const [name, data] of uploadedFiles) {
    const row = document.createElement("div");
    row.className = "files-row";
    const del = Object.assign(document.createElement("button"), { className: "mini-btn", textContent: "Remove", title: "Remove this file" });
    del.onclick = () => { uploadedFiles.delete(name); listOutputFiles(lastRunFiles); };
    row.append(document.createTextNode(`${name} (${data.length} B)  `), del);
    out.appendChild(row);
  }
  heading("Files the program created");
  if (!files) { line("(shown after the program runs)"); return; }
  for (const f of files) {
    const btn = document.createElement("button");
    btn.className = "mini-btn";
    btn.textContent = `Download ${f.name} (${f.size} B)`;
    btn.onclick = async () => {
      const data = await sim.call("readFile", { name: f.name }).catch(() => null);
      if (!data) { status("file is no longer available — run the program again", true); return; }
      downloadBlob(f.name, new Blob([data]));
    };
    out.appendChild(btn);
    line("");
  }
  if (!files.length) line("(the program created no files)");
}

async function loadExample(name) {
  if (blockedByDebug()) { $("examples").value = tabs[activeTab].name; return; }
  const paths = name === "stdin-demo.mms"
    ? ["examples/stdin-demo.mms", "../examples/stdin-demo.mms", "vendor/stdin-demo.mms"]
    : ["vendor/" + name, "../vendor/" + name, "examples/" + name, "../examples/" + name];
  for (const path of paths) {
    try {
      const res = await fetch(path);
      if (!res.ok) continue;
      const text = await res.text();
      saveActiveTab();
      const cur = tabs[activeTab];
      if (cur && cur.content.trim() && cur.content !== cur.loaded) newTab(name); // keep the user's edits
      currentStem = name.replace(/\.mms$/, "");
      tabs[activeTab].name = name;
      tabs[activeTab].stem = currentStem;
      tabs[activeTab].content = text;
      tabs[activeTab].fromExample = true;
      tabs[activeTab].breakpoints = [];
      tabs[activeTab].assembledSrc = null;
      tabs[activeTab].mmo = null;
      tabs[activeTab].listing = null;
      currentMmo = null;
      currentListing = null;
      updateRunButton();
      $("btn-download-mmo").disabled = true;
      $("btn-download-lst").disabled = true;
      setEditorContent(tabs[activeTab].content);
      tabs[activeTab].loaded = tabs[activeTab].content;
      if ($("examples").value !== name) $("examples").value = name;
      renderTabs();
      return;
    } catch (e) { /* try next path */ }
  }
  currentStem = "prog";
  status("cannot load " + name, true);
}

boot();
