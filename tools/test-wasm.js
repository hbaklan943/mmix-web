// Node-side parity test for the WASM builds:
// assemble vendor/hello.mms -> hello.mmo, simulate it, expect "hello, world".
"use strict";
const fs = require("fs");
const path = require("path");

const repo = path.resolve(__dirname, "..");
const wasmDir = path.join(repo, "build", "wasm");

function runTool(Init, args, files) {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    Init({
      noInitialRun: true,
      thisProgram: args[0],
      arguments: args.slice(1),
      print: (t) => { stdout += t + "\n"; },
      printErr: (t) => { stderr += t + "\n"; },
      onAbort: (what) => reject(new Error("abort: " + what)),
    }).then((M) => {
      try {
        for (const [name, data] of files) M.FS.writeFile(name, data);
        const rc = M.callMain(args.slice(1));
        resolve({ stdout, stderr, rc, FS: M.FS });
      } catch (e) {
        if (e && typeof e.status === "number")
          resolve({ stdout, stderr, rc: e.status, FS: M.FS });
        else reject(e);
      }
    }, reject);
  });
}

(async () => {
  const fail = (msg) => { console.error("FAIL:", msg); process.exit(1); };

  const initMmixal = require(path.join(wasmDir, "mmixal.js"));
  const initMmix = require(path.join(wasmDir, "mmix.js"));

  const mms = fs.readFileSync(path.join(repo, "vendor", "hello.mms"), "utf8");

  const asm = await runTool(initMmixal, ["mmixal", "hello.mms"], [["hello.mms", mms]]);
  if (asm.stderr.trim()) fail("mmixal stderr: " + asm.stderr);
  let mmo;
  try {
    mmo = asm.FS.readFile("hello.mmo");
  } catch {
    fail("mmixal produced no hello.mmo");
  }
  console.log("assembled:", mmo.length, "bytes");

  const sim = await runTool(initMmix, ["mmix", "-q", "hello"], [["hello.mmo", mmo]]);
  console.log("sim stdout:", JSON.stringify(sim.stdout));
  if (!/hello, world/.test(sim.stdout)) fail("unexpected simulator output");
  if (sim.stderr.trim()) fail("mmix stderr: " + sim.stderr);

  console.log("WASM PARITY OK");
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
