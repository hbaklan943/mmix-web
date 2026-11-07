/* help.js — built-in help: a short guide plus a reference of MMIX
   instructions, assembler directives, TRAP calls and special registers.
   Also provides one-line descriptions for the editor's hover tips. */
"use strict";

// [mnemonic(s), operands, description]. "$X,$Y,$Z|Z" = Z may be a register or
// an 8-bit constant; the assembler then emits the "immediate" opcode, which
// traces show with an I suffix (ADDUI, LDOUI, ...).
const MMIX_INSTRUCTIONS = [
  ["Arithmetic", [
    ["ADD", "$X,$Y,$Z|Z", "$X = $Y + $Z, signed. Overflow raises an integer overflow exception."],
    ["ADDU", "$X,$Y,$Z|Z", "$X = ($Y + $Z) mod 2⁶⁴, unsigned, never overflows."],
    ["2ADDU 4ADDU 8ADDU 16ADDU", "$X,$Y,$Z|Z", "$X = ($Y·k + $Z) mod 2⁶⁴ for k = 2, 4, 8, 16. Handy for array indexing."],
    ["SUB", "$X,$Y,$Z|Z", "$X = $Y − $Z, signed, with overflow check."],
    ["SUBU", "$X,$Y,$Z|Z", "$X = ($Y − $Z) mod 2⁶⁴."],
    ["MUL", "$X,$Y,$Z|Z", "$X = $Y × $Z, signed, with overflow check."],
    ["MULU", "$X,$Y,$Z|Z", "Unsigned 128-bit product: rH = upper 64 bits, $X = lower 64 bits."],
    ["DIV", "$X,$Y,$Z|Z", "$X = ⌊$Y / $Z⌋ (signed), rR = remainder. Dividing by 0 gives $X = 0, rR = $Y."],
    ["DIVU", "$X,$Y,$Z|Z", "Unsigned divide of the 128-bit number (rD, $Y) by $Z: $X = quotient, rR = remainder."],
    ["NEG", "$X,Y,$Z|Z", "$X = Y − $Z, signed (Y is a constant, usually 0: NEG $X,$Z negates)."],
    ["NEGU", "$X,Y,$Z|Z", "$X = (Y − $Z) mod 2⁶⁴."],
    ["CMP", "$X,$Y,$Z|Z", "$X = −1, 0 or +1 as $Y <, = or > $Z (signed)."],
    ["CMPU", "$X,$Y,$Z|Z", "Like CMP, but compares unsigned."],
    ["SL", "$X,$Y,$Z|Z", "$X = $Y shifted left by $Z bits, with overflow check."],
    ["SLU", "$X,$Y,$Z|Z", "$X = $Y shifted left by $Z bits, no overflow check."],
    ["SR", "$X,$Y,$Z|Z", "$X = $Y shifted right by $Z bits, copying the sign bit (arithmetic)."],
    ["SRU", "$X,$Y,$Z|Z", "$X = $Y shifted right by $Z bits, filling with zeros (logical)."],
  ]],
  ["Bitwise", [
    ["AND OR XOR", "$X,$Y,$Z|Z", "Bitwise and / or / exclusive or of $Y and $Z."],
    ["ANDN ORN", "$X,$Y,$Z|Z", "$Y and (not $Z) / $Y or (not $Z)."],
    ["NAND NOR NXOR", "$X,$Y,$Z|Z", "Not of and / or / xor."],
    ["MUX", "$X,$Y,$Z|Z", "Bit multiplex: $X = ($Y and rM) or ($Z and not rM)."],
    ["SADD", "$X,$Y,$Z|Z", "Sideways add: $X = number of 1 bits in $Y and (not $Z)."],
    ["BDIF WDIF TDIF ODIF", "$X,$Y,$Z|Z", "Saturating difference per byte / wyde / tetra / octa: max(0, y − z), unsigned."],
    ["MOR MXOR", "$X,$Y,$Z|Z", "Multiple or / xor: treats $Y and $Z as 8×8 bit matrices and multiplies them."],
  ]],
  ["Constants (wyde immediates)", [
    ["SETH SETMH SETML SETL", "$X,YZ", "$X = the 16-bit constant YZ placed in the high / medium-high / medium-low / low wyde; other bits 0."],
    ["INCH INCMH INCML INCL", "$X,YZ", "$X = $X + YZ shifted into that wyde."],
    ["ORH ORMH ORML ORL", "$X,YZ", "$X = $X or (YZ shifted into that wyde)."],
    ["ANDNH ANDNMH ANDNML ANDNL", "$X,YZ", "$X = $X and not (YZ shifted into that wyde)."],
    ["SET", "$X,$Y | $X,const", "Assembler shorthand: copies a register (OR $X,$Y,0) or loads a small constant (SETL)."],
  ]],
  ["Load and store", [
    ["LDB LDW LDT LDO", "$X,$Y,$Z|Z", "Load a signed byte / wyde / tetra / octa from address $Y + $Z (rounded down to the unit size)."],
    ["LDBU LDWU LDTU LDOU", "$X,$Y,$Z|Z", "Load an unsigned (zero-extended) byte / wyde / tetra / octa from address $Y + $Z."],
    ["LDA", "$X,$Y,$Z|Z | $X,label", "$X = address $Y + $Z (same as ADDU). With a label, uses a base register from GREG."],
    ["LDHT", "$X,$Y,$Z|Z", "Load high tetra: $X = M₄[A] shifted left 32 bits."],
    ["LDSF", "$X,$Y,$Z|Z", "Load a 32-bit short float and convert it to a 64-bit float."],
    ["LDUNC", "$X,$Y,$Z|Z", "Load octa, uncached (same result as LDO)."],
    ["STB STW STT STO", "$X,$Y,$Z|Z", "Store the low byte / wyde / tetra / octa of $X at $Y + $Z; signed overflow check."],
    ["STBU STWU STTU STOU", "$X,$Y,$Z|Z", "Store the low byte / wyde / tetra / octa of $X at $Y + $Z, without an overflow check."],
    ["STHT", "$X,$Y,$Z|Z", "Store high tetra: M₄[A] = upper 32 bits of $X."],
    ["STSF", "$X,$Y,$Z|Z", "Store $X as a 32-bit short float."],
    ["STCO", "X,$Y,$Z|Z", "Store the constant X (0…255) as an octa."],
    ["STUNC", "$X,$Y,$Z|Z", "Store octa, uncached."],
    ["CSWAP", "$X,$Y,$Z|Z", "Compare and swap: if M₈[A] = rP then M₈[A] = $X, $X = 1; else rP = M₈[A], $X = 0."],
    ["PRELD PREST PREGO SYNCD SYNCID", "X,$Y,$Z|Z", "Cache hints; they do not change any register or memory value."],
  ]],
  ["Jumps and branches", [
    ["JMP", "label", "Jump to label."],
    ["GO", "$X,$Y,$Z|Z", "$X = address of the next instruction, then jump to $Y + $Z."],
    ["BZ BNZ", "$X,label", "Branch if $X is zero / not zero."],
    ["BN BNN", "$X,label", "Branch if $X is negative / not negative."],
    ["BP BNP", "$X,label", "Branch if $X is positive / not positive."],
    ["BOD BEV", "$X,label", "Branch if $X is odd / even."],
    ["PBZ PBNZ PBN PBNN PBP PBNP PBOD PBEV", "$X,label", "Probable branch: same as the B… form, but tells the CPU the branch is likely taken."],
    ["GETA", "$X,label", "$X = address of label."],
    ["PUSHJ", "$X,label", "Call a subroutine: $0…$X−1 are saved and hidden, rJ = return address, and the caller's $X+1, $X+2, … become the callee's $0, $1, … (its arguments). The result arrives in $X."],
    ["PUSHGO", "$X,$Y,$Z|Z", "Like PUSHJ, but calls address $Y + $Z."],
    ["POP", "X,YZ", "Return from a subroutine passing back X results (POP 1,0 returns the callee's $0), continuing at rJ + 4·YZ."],
  ]],
  ["Conditional set", [
    ["CSZ CSNZ CSN CSNN CSP CSNP CSOD CSEV", "$X,$Y,$Z|Z", "If $Y is zero / not zero / negative / … then $X = $Z, otherwise $X is unchanged."],
    ["ZSZ ZSNZ ZSN ZSNN ZSP ZSNP ZSOD ZSEV", "$X,$Y,$Z|Z", "If the condition on $Y holds then $X = $Z, otherwise $X = 0."],
  ]],
  ["Floating point (64-bit IEEE)", [
    ["FADD FSUB FMUL FDIV", "$X,$Y,$Z", "Floating add / subtract / multiply / divide."],
    ["FREM", "$X,$Y,$Z", "Floating remainder of $Y / $Z (IEEE)."],
    ["FSQRT", "$X,$Z | $X,Y,$Z", "$X = square root of $Z (Y = optional rounding mode)."],
    ["FINT", "$X,$Z | $X,Y,$Z", "Round $Z to an integer value, kept as a float."],
    ["FIX FIXU", "$X,$Z | $X,Y,$Z", "Convert the float $Z to a signed integer / unsigned integer (mod 2⁶⁴)."],
    ["FLOT FLOTU", "$X,$Z|Z", "Convert the signed / unsigned integer $Z to a float."],
    ["SFLOT SFLOTU", "$X,$Z|Z", "Like FLOT / FLOTU, rounded to short-float precision."],
    ["FCMP", "$X,$Y,$Z", "$X = −1, 0 or +1 as $Y <, = or > $Z (floats)."],
    ["FEQL FUN", "$X,$Y,$Z", "$X = 1 if $Y = $Z / if they are unordered (a NaN is involved), else 0."],
    ["FCMPE FEQLE FUNE", "$X,$Y,$Z", "Like FCMP / FEQL / FUN, but \"equal\" means within the relative epsilon in rE."],
  ]],
  ["System", [
    ["TRAP", "X,Y,Z", "Call the operating system, e.g. TRAP 0,Fputs,StdOut or TRAP 0,Halt,0. See the TRAP table below."],
    ["TRIP", "X,Y,Z", "Trigger a trip (user-level interrupt) handled at location #0."],
    ["RESUME", "0", "Return from a trip handler."],
    ["GET", "$X,rA", "$X = special register."],
    ["PUT", "rA,$Z|Z", "Special register = $Z."],
    ["SAVE", "$X,0", "Push all registers onto the register stack; $X = its address."],
    ["UNSAVE", "$Z", "Restore the registers saved by SAVE."],
    ["SYNC", "XYZ", "Synchronise memory operations (no visible effect in the simulator)."],
    ["SWYM", "", "No operation (\"sympathize with your machinery\")."],
  ]],
  ["Assembler directives", [
    ["IS", "label IS expr", "Defines a symbol, e.g. argv IS $1, or N IS 10."],
    ["LOC", "LOC expr", "Sets the address where the following code or data goes (LOC #100, LOC Data_Segment)."],
    ["GREG", "label GREG expr", "Allocates a global register holding expr; with @ it serves as a base address for LDA/LDO of labels."],
    ["BYTE WYDE TETRA OCTA", "label BYTE x,y,…", "Places 1 / 2 / 4 / 8-byte values (BYTE also takes \"strings\")."],
    ["PREFIX", "PREFIX name:", "Prefix added to following symbols (for local names)."],
    ["LOCAL", "LOCAL $X", "Ensures $X stays a local register (below rG)."],
    ["BSPEC ESPEC", "", "Begin / end special data in the object file."],
  ]],
];

const MMIX_TRAPS = [
  ["Halt", "TRAP 0,Halt,0", "End the program."],
  ["Fputs", "TRAP 0,Fputs,StdOut", "Write the zero-terminated string at $255. $255 = number of bytes written."],
  ["Fputws", "TRAP 0,Fputws,StdOut", "Write a zero-terminated string of wydes."],
  ["Fgets", "TRAP 0,Fgets,StdIn", "$255 points to (buffer, size): read one line, up to size−1 bytes. $255 = length, or −1 at end of input."],
  ["Fgetws", "TRAP 0,Fgetws,StdIn", "Like Fgets, for wyde characters."],
  ["Fread", "TRAP 0,Fread,handle", "$255 points to (buffer, size): read size bytes. $255 = 0, or negative if fewer were read."],
  ["Fwrite", "TRAP 0,Fwrite,handle", "$255 points to (buffer, size): write size bytes."],
  ["Fopen", "TRAP 0,Fopen,handle", "$255 points to (name, mode). Modes: TextRead 0, TextWrite 1, BinaryRead 2, BinaryWrite 3, BinaryReadWrite 4. Handles 3…255 are free."],
  ["Fclose", "TRAP 0,Fclose,handle", "Close the file."],
  ["Fseek", "TRAP 0,Fseek,handle", "Move to byte position $255; a negative value counts from the end (−1 = end of file)."],
  ["Ftell", "TRAP 0,Ftell,handle", "$255 = current position."],
];

const MMIX_SPECIAL_REGS = [
  ["rA", "arithmetic status: exception enable and event bits, rounding mode"],
  ["rB", "bootstrap register for trips (holds $255 during a trip)"],
  ["rC", "cycle counter"],
  ["rD", "dividend: upper 64 bits for DIVU"],
  ["rE", "epsilon for FCMPE, FEQLE, FUNE"],
  ["rF", "failure location"],
  ["rG", "global threshold: $G … $255 are global registers"],
  ["rH", "himult: upper 64 bits of a MULU product"],
  ["rI", "interval counter (counts down every instruction)"],
  ["rJ", "return-jump: return address set by PUSHJ / PUSHGO"],
  ["rK", "interrupt mask"],
  ["rL", "local threshold: $0 … $L−1 are local registers in use"],
  ["rM", "multiplex mask for MUX"],
  ["rN", "serial number of the machine"],
  ["rO", "register stack offset"],
  ["rP", "prediction register for CSWAP"],
  ["rQ", "interrupt request"],
  ["rR", "remainder of DIV / DIVU"],
  ["rS", "register stack pointer"],
  ["rT", "trap address"],
  ["rU", "usage counter (instructions executed)"],
  ["rV", "virtual translation register"],
  ["rW rX rY rZ", "where-interrupted, execution, Y and Z operand of a trip"],
  ["rBB rTT rWW rXX rYY rZZ", "the same for traps (operating-system level)"],
];

const HELP_SHORTCUTS = [
  ["Ctrl+O", "Open a .mms file"],
  ["Ctrl+S / Ctrl+Shift+S", "Save file / Save as"],
  ["Ctrl+Enter", "Assemble"],
  ["F5", "Run (Continue while debugging)"],
  ["Shift+F5", "Stop"],
  ["F11 or F7", "Debug: step one instruction"],
  ["F10", "Debug: step over a subroutine call"],
  ["Shift+F11", "Debug: step out of the subroutine"],
  ["F8", "Debug: continue to the next breakpoint"],
  ["F9", "Toggle breakpoint on the cursor line"],
  ["Ctrl+F10", "Debug: run to the cursor line"],
  ["Tab / Shift+Tab", "Next / previous MMIXAL column"],
  ["Shift+Alt+F", "Format: line up labels, instructions, operands, comments"],
  ["Ctrl + / Ctrl − / Ctrl 0", "Editor font larger / smaller / default (A− A+ buttons)"],
  ["F1", "Show this help"],
];

/* ---------- lookup for hover tips ---------- */
const MMIX_OPCODE_HELP = (() => {
  const m = new Map();
  for (const [, rows] of MMIX_INSTRUCTIONS)
    for (const [names, ops, desc] of rows)
      for (const n of names.split(/\s+/)) if (!m.has(n)) m.set(n, { name: n, ops, desc });
  for (const [n, usage, desc] of MMIX_TRAPS) m.set(n, { name: n, ops: usage, desc });
  return m;
})();

function mmixHelpFor(word) {
  if (!word) return null;
  const w = word.toUpperCase();
  const hit = MMIX_OPCODE_HELP.get(w) || MMIX_OPCODE_HELP.get(word);
  if (hit) return hit;
  // Trace output names immediate / backward variants: ADDUI, JMPB, BNZB …
  const base = w.replace(/I$/, "").replace(/B$/, "");
  return MMIX_OPCODE_HELP.get(base) || null;
}

/* ---------- the Help panel ---------- */
function renderHelp(container) {
  const esc = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const instrRows = MMIX_INSTRUCTIONS.map(([group, rows]) =>
    `<tr class="help-group"><th colspan="3">${esc(group)}</th></tr>` +
    rows.map(([n, o, d]) => `<tr data-search="${esc((n + " " + d).toLowerCase())}"><td class="help-op">${esc(n)}</td><td class="help-args">${esc(o)}</td><td>${esc(d)}</td></tr>`).join("")
  ).join("");
  container.innerHTML = `
  <div class="help-body">
    <nav class="help-nav">
      <a href="#help-start">Getting started</a><a href="#help-debug">Debugging</a><a href="#help-memory">Memory</a>
      <a href="#help-instr">Instructions</a><a href="#help-traps">TRAPs</a><a href="#help-regs">Special registers</a><a href="#help-keys">Shortcuts</a>
    </nav>

    <h3 id="help-start">Getting started</h3>
    <ol>
      <li>Write MMIXAL in the editor, or pick an example from the menu at the top left.</li>
      <li><b>Assemble</b> (Ctrl+Enter) turns it into an <code>.mmo</code> object file; errors are marked in the editor and listed in the Assembler panel.</li>
      <li><b>Run</b> (F5) assembles if needed and runs it. Program output appears in Output; what the program reads from <code>StdIn</code> comes from the Input panel.</li>
      <li>After a run, the register panels and Memory show the final machine state.</li>
    </ol>
    <p>A program starts at <code>Main</code>. <code>$0</code> is argc and <code>$1</code> points to argv. End it with <code>TRAP 0,Halt,0</code>.</p>
    <p><b>Trace</b> prints every executed instruction, <b>Profile</b> counts how often each line ran, <b>Stats</b> prints instruction and memory counts at the end.</p>

    <h3 id="help-debug">Debugging</h3>
    <p><b>Debug</b> executes the first instruction and pauses, as MMIXVD does. The red ▶ marks the instruction that was <i>executed last</i>; registers and memory show the state right after it.</p>
    <ul>
      <li><b>Step</b> runs one instruction; <b>Over</b> runs a PUSHJ/PUSHGO call as one step; <b>Out</b> runs until the current subroutine returns.</li>
      <li><b>Continue</b> runs to the next breakpoint; <b>Break</b> pauses a program that is running; <b>Stop</b> ends the session.</li>
      <li>Click left of a line number (or press F9) to set a breakpoint. Execution stops right <i>after</i> that line has run (like MMIXVD).</li>
      <li>Registers changed by the last step are highlighted in red.</li>
    </ul>

    <h3 id="help-memory">Memory and segments</h3>
    <p>MMIX has a 64-bit address space. User programs see four segments, each 2⁶¹ bytes:</p>
    <table class="help-table">
      <tr><td class="help-op">Text</td><td><code>#0000000000000000</code></td><td>program code (usually from <code>LOC #100</code>)</td></tr>
      <tr><td class="help-op">Data</td><td><code>#2000000000000000</code></td><td>variables, strings (<code>LOC Data_Segment</code>)</td></tr>
      <tr><td class="help-op">Pool</td><td><code>#4000000000000000</code></td><td>command-line arguments (argv) and dynamic storage</td></tr>
      <tr><td class="help-op">Stack</td><td><code>#6000000000000000</code></td><td>the register stack (used by PUSHJ / SAVE)</td></tr>
    </table>
    <p>Addresses from <code>#8000…</code> up are the operating system's ("negative") segment, which user programs cannot touch. In the Memory panel's <i>Go to</i> box you can type an address (<code>#2000000000000000</code>), a segment name, or a label from your program (<code>Msg</code>).</p>

    <h3 id="help-instr">Instructions</h3>
    <p>Most instructions take <code>$X,$Y,$Z</code> or <code>$X,$Y,Z</code> (Z a constant 0…255). The constant form is a separate opcode; traces show it with an <b>I</b> suffix (<code>ADDUI</code>). Backward jumps get a <b>B</b> suffix (<code>JMPB</code>). Hover over an instruction in the editor to see its description.</p>
    <input id="help-search" type="text" placeholder="Filter instructions, e.g. load, branch, PUSHJ" spellcheck="false">
    <table class="help-table help-instr">${instrRows}</table>

    <h3 id="help-traps">TRAP calls (operating system)</h3>
    <p>Handles: <code>StdIn</code> = 0, <code>StdOut</code> = 1, <code>StdErr</code> = 2. Arguments and results go through <code>$255</code>.</p>
    <table class="help-table">${MMIX_TRAPS.map(([n, u, d]) => `<tr><td class="help-op">${esc(n)}</td><td class="help-args">${esc(u)}</td><td>${esc(d)}</td></tr>`).join("")}</table>

    <h3 id="help-regs">Special registers</h3>
    <table class="help-table">${MMIX_SPECIAL_REGS.map(([n, d]) => `<tr><td class="help-op">${esc(n)}</td><td>${esc(d)}</td></tr>`).join("")}</table>

    <h3 id="help-keys">Keyboard shortcuts</h3>
    <table class="help-table">${HELP_SHORTCUTS.map(([k, d]) => `<tr><td class="help-op">${esc(k)}</td><td>${esc(d)}</td></tr>`).join("")}</table>

    <p class="help-foot">mmix-web runs Donald Knuth's MMIXware (mmixal and mmix-sim) compiled to WebAssembly. More: <a href="https://mmix.cs.hm.edu/" target="_blank" rel="noopener">mmix.cs.hm.edu</a>.</p>
  </div>`;
  const search = container.querySelector("#help-search");
  search.oninput = () => {
    const q = search.value.trim().toLowerCase();
    container.querySelectorAll(".help-instr tr[data-search]").forEach((tr) => {
      tr.hidden = q && !tr.dataset.search.includes(q);
    });
    container.querySelectorAll(".help-instr tr.help-group").forEach((g) => {
      let n = g.nextElementSibling, any = false;
      while (n && !n.classList.contains("help-group")) { if (!n.hidden) any = true; n = n.nextElementSibling; }
      g.hidden = !!q && !any;
    });
  };
  container.querySelectorAll(".help-nav a").forEach((a) => {
    a.onclick = (e) => {
      e.preventDefault();
      const t = container.querySelector(a.getAttribute("href"));
      if (t) t.scrollIntoView({ block: "start" });
    };
  });
}

/* ---------- hover tips in the editor ---------- */
function initOpcodeTips(cm) {
  const tip = document.createElement("div");
  tip.className = "op-tip";
  tip.hidden = true;
  document.body.appendChild(tip);
  let last = null;
  cm.getWrapperElement().addEventListener("mousemove", (e) => {
    const pos = cm.coordsChar({ left: e.clientX, top: e.clientY }, "window");
    const tok = cm.getTokenAt(pos, true);
    const ok = tok && tok.string && (tok.type === "keyword" || tok.type === "builtin" || tok.type === "atom");
    const info = ok && pos.ch < tok.end && pos.ch >= tok.start - 0 ? mmixHelpFor(tok.string) : null;
    if (!info) { tip.hidden = true; last = null; return; }
    if (last !== info) {
      tip.innerHTML = `<b>${info.name}</b> <span class="op-tip-args">${info.ops.replace(/</g, "&lt;")}</span><div>${info.desc.replace(/</g, "&lt;")}</div>`;
      last = info;
    }
    tip.hidden = false;
    const x = Math.min(e.clientX + 14, window.innerWidth - tip.offsetWidth - 8);
    tip.style.left = x + "px";
    tip.style.top = e.clientY + 18 + "px";
  });
  cm.getWrapperElement().addEventListener("mouseleave", () => { tip.hidden = true; });
}
