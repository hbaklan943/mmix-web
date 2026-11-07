"use strict";
const { spawn } = require("child_process");
const http = require("http");
const os = require("os");
const path = require("path");
const fs = require("fs");
const PORT = 9336;
const url = "http://localhost:8642/web/index.html";
function httpJson(m,p){return new Promise((res,rej)=>{const r=http.request({host:"127.0.0.1",port:PORT,method:m,path:p},rs=>{let b="";rs.on("data",d=>b+=d);rs.on("end",()=>{try{res(JSON.parse(b))}catch{res(b)}})});r.on("error",rej);r.end()})}
function connect(u){return new Promise((res,rej)=>{const ws=new WebSocket(u);let id=0;const p=new Map();ws.onopen=()=>res({send(m,par){return new Promise((r2,rj2)=>{const mid=++id;p.set(mid,{r2,rj2});ws.send(JSON.stringify({id:mid,method:m,params:par}))}),on(e,fn){ws.onmessage=ev=>{const m=JSON.parse(ev.data);if(m.id&&p.has(m.id)){const x=p.get(m.id);p.delete(m.id);m.error?x.rj2(new Error(JSON.stringify(m.error))):x.r2(m.result)}else if(m.method===e)fn(m.params)}}},close(){ws.close()}});ws.onerror=e=>rej(new Error("ws "+e.message));ws.onmessage=ev=>{}})}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  const exe=fs.existsSync("C:/Program Files/Google/Chrome/Application/chrome.exe")?"C:/Program Files/Google/Chrome/Application/chrome.exe":"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
  const prof=fs.mkdtempSync(path.join(os.tmpdir(),"mmixdbg2-"));
  const br=spawn(exe,["--headless=new",`--remote-debugging-port=${PORT}`,`--user-data-dir=${prof}`,"--no-first-run","--disable-gpu","--window-size=1280,800","about:blank"],{stdio:"ignore"});
  for(let i=0;i<60;i++){try{await httpJson("GET","/json/version");break}catch{await sleep(250)}}
  const t=await httpJson("PUT","/json/new?about:blank");
  const cdp=await connect(t.webSocketDebuggerUrl);
  const msgs=[];cdp.on("Runtime.consoleAPICalled",p=>msgs.push(`[${p.type}] `+p.args.map(a=>a.value!==undefined?JSON.stringify(a.value):a.description||a.type).join(" ")));
  cdp.on("Runtime.exceptionThrown",p=>{const d=p.exceptionDetails;msgs.push("[exc] "+(d.text||"")+JSON.stringify(d.exception||d))});
  await cdp.send("Runtime.enable");await cdp.send("Page.enable");await cdp.send("Page.navigate",{url});
  await sleep(6000);
  await cdp.send("Runtime.evaluate",{expression:`(async()=>{const s=document.getElementById('examples'); s.value='stdin-demo.mms'; s.onchange(); await new Promise(r=>setTimeout(r,1500)); console.log('AFTERSELECT stem=', currentStem, 'editorlen=', editor.getValue().length, 'firstline=', JSON.stringify(editor.getValue().split('\\n')[0]));})()`});
  await sleep(2500);
  console.log("MSGS:", msgs.join("\n"));
  cdp.close(); br.kill(); process.exit(0);
})().catch(e=>{console.error(e);process.exit(1)})
