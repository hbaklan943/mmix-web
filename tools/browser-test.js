// Headless-browser E2E test for mmix-web over the Chrome DevTools Protocol.
// Launches Chrome/Edge headless, opens the UI, clicks Assemble then Run,
// and reports what the status line and output panes contain.
// Usage: node tools\browser-test.js [url]
"use strict";
const { spawn } = require("child_process");
const http = require("http");
const os = require("os");
const path = require("path");
const fs = require("fs");

const PORT = 9333;
const URL_BASE = process.argv[3] || "http://localhost:8642/web/index.html";

function findBrowser() {
  const candidates = [
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    process.env.LOCALAPPDATA + "/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  throw new Error("no Chrome/Edge found");
}

function httpJson(method, reqPath) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port: PORT, method, path: reqPath },
      (res) => {
        let body = "";
        res.on("data", (d) => (body += d));
        res.on("end", () => {
          try { resolve(JSON.parse(body)); } catch (e) { resolve(body); }
        });
      }
    );
    req.on("error", reject);
    req.end();
  });
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pending = new Map();
    const events = [];
    const listeners = [];
    ws.onopen = () => resolve({
      send(method, params) {
        return new Promise((res2, rej2) => {
          const msgId = ++id;
          pending.set(msgId, { res: res2, rej: rej2 });
          ws.send(JSON.stringify({ id: msgId, method, params }));
        });
      },
      on(method, fn) { listeners.push({ method, fn }); },
      drainEvents() { return events.splice(0); },
      close() { ws.close(); },
    });
    ws.onerror = (e) => reject(new Error("ws error " + e.message));
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        const p = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) p.rej(new Error(JSON.stringify(msg.error)));
        else p.res(msg.result);
      } else if (msg.method) {
        for (const l of listeners) if (l.method === msg.method) l.fn(msg.params);
        events.push(msg);
      }
    };
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function evalJS(cdp, expr) {
  const r = await cdp.send("Runtime.evaluate", {
    expression: expr,
    returnByValue: true,
    awaitPromise: true,
  });
  if (r.exceptionDetails) throw new Error("page eval: " + JSON.stringify(r.exceptionDetails));
  return r.result && r.result.value;
}

(async () => {
  const fail = (m) => { console.error("FAIL:", m); process.exit(1); };

  // 1) launch headless browser
  const exe = findBrowser();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "mmixchrome-"));
  const chrome = spawn(exe, [
    "--headless=new",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    "--no-first-run", "--disable-gpu", "--window-size=1280,800",
    "about:blank",
  ], { stdio: "ignore" });

  // wait for CDP
  let version = null;
  for (let i = 0; i < 60; i++) {
    try { version = await httpJson("GET", "/json/version"); break; } catch { await sleep(250); }
  }
  if (!version) fail("CDP never came up");

  // 2) open the page
  const target = await httpJson("PUT", `/json/new?${URL_BASE}`);
  if (!target || !target.webSocketDebuggerUrl) fail(JSON.stringify(target));
  const cdp = await connect(target.webSocketDebuggerUrl);

  const consoleMsgs = [];
  cdp.on("Runtime.consoleAPICalled", (p) => {
    const text = p.args.map((a) => a.value !== undefined ? String(a.value) : a.description || "").join(" ");
    consoleMsgs.push(`[${p.type}] ${text}`);
  });
  cdp.on("Runtime.exceptionThrown", () => consoleMsgs.push("[exception]"));

  await cdp.send("Runtime.enable");
  // page already navigating; give it a moment then poll status
  await sleep(1500);

  const waitFor = async (expr, desc, timeoutMs) => {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      const v = await evalJS(cdp, expr);
      if (v) return v;
      await sleep(400);
    }
    fail("timeout waiting for " + desc);
  };

  await waitFor(`document.body && /loading|ready|error/.test((document.getElementById('status')||{}).textContent||'')`, "status element", 15000);
  console.log("[status]", await evalJS(cdp, "document.getElementById('status').textContent"));
  await waitFor("/toolchain ready/.test(document.getElementById('status').textContent)", "toolchain ready", 40000);

  // Instead, evaluate a global hook: store messages in window.__msgs
  await evalJS(cdp, "window.__msgs=[]; const _log=console.log; console.log=(...a)=>{window.__msgs.push(a.join(' '));_log(...a)}");
  const examples = process.argv[2] === "full"
    ? [{ name: "stdin-demo.mms", stdin: "hello from stdin", expect: "hello from stdin" },
       { name: "hello.mms", expect: "hello, world" },
       { name: "fib.mms" },
       { name: "primes.mms", expect: "First Five Hundred Primes" }]  // sort.mms panics at EOF by design; needs -b 250 too
    : [{ name: "stdin-demo.mms", stdin: "hello from stdin", expect: "hello from stdin" },
       { name: "hello.mms", expect: "hello, world" },
       { name: "fib.mms" }];
  for (const ex of examples) {
    await evalJS(cdp, `document.getElementById('examples').value = "${ex.name}"`);
    await evalJS(cdp, `(async()=>{ await window.loadExample("${ex.name}"); return true; })()`);
    await sleep(300);
    if (ex.stdin) await evalJS(cdp, `document.getElementById('stdin').value = "${ex.stdin}"`);
    await evalJS(cdp, "document.getElementById('btn-assemble').click()");
    await waitFor("/Ready|error/.test(document.getElementById('status').textContent)", "assemble done (" + ex.name + ")", 30000);
    const st = await evalJS(cdp, "document.getElementById('status').textContent");
    const asm = (await evalJS(cdp, "document.getElementById('asm-output').textContent")).trim();
    if (/error/.test(st)) fail(`assemble ${ex.name}: ${st}\n${asm}`);
    await evalJS(cdp, "document.getElementById('btn-run').click()");
    // wait for run to complete: status becomes "done" (possibly without stdout)
    await waitFor("/done|error|aborted/.test(document.getElementById('status').textContent)", "run done (" + ex.name + ")", 60000);
    const runSt = await evalJS(cdp, "document.getElementById('status').textContent");
    const sim = (await evalJS(cdp, "document.getElementById('sim-output').textContent")).trim();
    console.log(`[${ex.name}] status=${runSt}`);
    console.log(sim ? sim.split("\n").slice(0, 4).join(" ⏎ ") : "(no stdout)");
    if (/error|aborted/.test(runSt)) fail(`run ${ex.name}: ${runSt}`);
    if (ex.expect && !sim.includes(ex.expect)) fail(`${ex.name}: expected "${ex.expect}" in output`);
    const regs = await evalJS(cdp, "document.getElementById('reg-output').textContent");
    if (!/inst_ptr/.test(regs)) fail(`${ex.name}: registers not populated`);
    const lstDisabled = await evalJS(cdp, "document.getElementById('btn-download-lst').disabled");
    if (lstDisabled) fail(`${ex.name}: listing button still disabled`);
  }

  const msgs = await evalJS(cdp, "window.__msgs");
  console.log("console:", msgs.join(" | "));

  console.log("BROWSER E2E OK");
  cdp.close();
  chrome.kill();
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});