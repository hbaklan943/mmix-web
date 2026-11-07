// White-page diagnostic: load the UI headless, dump console + DOM state + screenshot.
"use strict";
const { spawn } = require("child_process");
const http = require("http");
const os = require("os");
const path = require("path");
const fs = require("fs");

const PORT = 9334;
const url = process.argv[2] || "http://localhost:8642/web/index.html";

function httpJson(method, reqPath) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port: PORT, method, path: reqPath }, (res) => {
      let b = ""; res.on("data", (d) => (b += d)); res.on("end", () => { try { resolve(JSON.parse(b)); } catch { resolve(b); } });
    });
    req.on("error", reject); req.end();
  });
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0; const pending = new Map(); const listeners = [];
    ws.onopen = () => resolve({
      send(method, params) {
        return new Promise((res, rej) => {
          const mid = ++id; pending.set(mid, { res, rej });
          ws.send(JSON.stringify({ id: mid, method, params }));
        });
      },
      on(method, fn) { listeners.push({ method, fn }); },
      close() { ws.close(); },
    });
    ws.onerror = (e) => reject(new Error("ws error " + e.message));
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) {
        const p = pending.get(m.id); pending.delete(m.id);
        m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result);
      } else if (m.method) for (const l of listeners) if (l.method === m.method) l.fn(m.params);
    };
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const exe = fs.existsSync("C:/Program Files/Google/Chrome/Application/chrome.exe")
    ? "C:/Program Files/Google/Chrome/Application/chrome.exe"
    : "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "mmixdbg-"));
  const browser = spawn(exe, [
    "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    "--no-first-run", "--disable-gpu", "--window-size=1280,800", "about:blank",
  ], { stdio: "ignore" });

  for (let i = 0; i < 60; i++) { try { await httpJson("GET", "/json/version"); break; } catch { await sleep(250); } }
  const target = await httpJson("PUT", `/json/new?about:blank`);
  const cdp = await connect(target.webSocketDebuggerUrl);
  const msgs = [];
  await cdp.send("Runtime.enable");
  await cdp.send("Log.enable");
  await cdp.send("Network.enable");
  cdp.on("Runtime.consoleAPICalled", (p) => msgs.push(`[${p.type}] ` + p.args.map(a => a.value !== undefined ? JSON.stringify(a.value) : a.description || a.type).join(" ")));
  cdp.on("Runtime.exceptionThrown", (p) => { const d = p.exceptionDetails; msgs.push("[exception] " + (d.text || "") + " " + JSON.stringify(d.exception || d)); });
  cdp.on("Log.entryAdded", (p) => msgs.push(`[log:${p.entry.level}] ${p.entry.text} ${p.entry.url || ""}`.trim()));
  cdp.on("Network.responseReceived", (p) => { if (p.response.status >= 400) msgs.push(`[http] ${p.response.status} ${p.response.url}`); });

  await cdp.send("Page.navigate", { url });
  await sleep(6000);
  const state = await cdp.send("Runtime.evaluate", {
    expression: `JSON.stringify({
      readyState: document.readyState,
      scripts: [...document.scripts].map(s=>s.src),
      statusEl: (document.getElementById('status')||{}).textContent,
      bodyLen: document.body ? document.body.innerHTML.length : -1,
      bodyStart: document.body ? document.body.innerHTML.slice(0,300) : ''
    })`, returnByValue: true,
  });
  console.log("STATE:", state.result.value);
  console.log("LOG:", msgs.join("\n"));

  const shot = await cdp.send("Page.captureScreenshot", { format: "png" });
  const shotPath = path.join(process.cwd(), "debug-page.png");
  fs.writeFileSync(shotPath, Buffer.from(shot.data, "base64"));
  console.log("SHOT:", shotPath);

  cdp.close(); browser.kill();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
