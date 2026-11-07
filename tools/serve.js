// Minimal static file server for local development.
// Usage: node tools/serve.js [port]   (default 8080, serves repo root)
const http = require("http");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const port = Number(process.argv[2]) || 8080;

const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".wasm": "application/wasm",
  ".css": "text/css; charset=utf-8",
  ".mms": "text/plain; charset=utf-8",
  ".mmo": "application/octet-stream",
  ".json": "application/json",
};

http
  .createServer((req, res) => {
    const urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname);
    let file = path.normalize(path.join(root, urlPath));
    // path.relative, not startsWith: "mmix-web-old" starts with "mmix-web" too
    const rel = path.relative(root, file);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      res.writeHead(403).end("forbidden");
      return;
    }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory())
      file = path.join(file, "index.html");
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404).end("not found");
        return;
      }
      res.writeHead(200, {
        "Content-Type": types[path.extname(file)] || "application/octet-stream",
        // Development server: always revalidate, so edits show up on reload
        // instead of the browser reusing stale app.js / style.css.
        "Cache-Control": "no-cache",
      });
      res.end(data);
    });
  })
  .listen(port, () => console.log(`serving ${root} on http://localhost:${port}`));
