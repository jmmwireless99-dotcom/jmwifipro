/**
 * Local preview server for Sales History dashboard.
 *   node deploy/preview-sales-history.mjs
 *   open http://127.0.0.1:3055/sales-history
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PORT || 3055);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", "http://127.0.0.1");
  let rel = url.pathname;
  if (rel === "/" || rel === "/sales-history") rel = "/public/sales-history.html";
  else if (rel.startsWith("/lib/")) rel = rel;
  else if (rel.startsWith("/public/")) rel = rel;
  else {
    res.writeHead(404).end("not found");
    return;
  }
  const file = path.join(ROOT, rel.replace(/^\//, ""));
  if (!file.startsWith(ROOT) || !fs.existsSync(file)) {
    res.writeHead(404).end("not found");
    return;
  }
  const ext = path.extname(file);
  res.writeHead(200, { "Content-Type": TYPES[ext] || "application/octet-stream", "Cache-Control": "no-store" });
  res.end(fs.readFileSync(file));
});

server.listen(PORT, "127.0.0.1", () => {
  console.log("Sales History preview → http://127.0.0.1:" + PORT + "/sales-history");
});
