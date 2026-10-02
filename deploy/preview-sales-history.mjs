/**
 * Local preview: landing + Sales History.
 *   node deploy/preview-sales-history.mjs
 *   open http://127.0.0.1:3055/          (landing with Sales History button)
 *   open http://127.0.0.1:3055/sales-history
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { patchLandingHtml, patchOperatorHtml } from "../lib/sales-history-nav.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PORT || 3055);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", "http://127.0.0.1");
  const p = url.pathname;

  try {
    if (p === "/" || p === "/index.html") {
      const html = read("public/landing/index.html");
      res.writeHead(200, { "Content-Type": TYPES[".html"], "Cache-Control": "no-store" });
      return res.end(html);
    }
    if (p === "/sales-history") {
      res.writeHead(200, { "Content-Type": TYPES[".html"], "Cache-Control": "no-store" });
      return res.end(read("public/sales-history.html"));
    }
    if (p === "/operator" || p === "/operator/") {
      // Demo operator sidebar with Sales History button (from live snapshot if present)
      let src = "";
      const live = "/tmp/operator.html";
      if (fs.existsSync(live)) src = fs.readFileSync(live, "utf8");
      else if (fs.existsSync(path.join(ROOT, "public/index.html"))) src = read("public/index.html").toString("utf8");
      else {
        res.writeHead(404).end("operator snapshot missing");
        return;
      }
      const patched = patchOperatorHtml(src);
      res.writeHead(200, { "Content-Type": TYPES[".html"], "Cache-Control": "no-store" });
      return res.end(patched.src);
    }
    if (p === "/isp-landing.css" || p.startsWith("/isp-landing.css")) {
      res.writeHead(200, { "Content-Type": TYPES[".css"], "Cache-Control": "no-store" });
      return res.end(read("public/isp-landing.css"));
    }
    if (p.startsWith("/lib/") && p.endsWith(".mjs")) {
      const safe = path.normalize(p.replace(/^\/lib\//, "")).replace(/^(\.\.[/\\])+/, "");
      res.writeHead(200, { "Content-Type": TYPES[".mjs"], "Cache-Control": "no-store" });
      return res.end(read(path.join("lib", safe)));
    }
    if (p.startsWith("/landing/") || p.startsWith("/portal/")) {
      const file = path.join(ROOT, "public", p.replace(/^\//, ""));
      if (!file.startsWith(ROOT) || !fs.existsSync(file)) {
        res.writeHead(404).end("not found");
        return;
      }
      const ext = path.extname(file);
      res.writeHead(200, { "Content-Type": TYPES[ext] || "application/octet-stream" });
      return res.end(fs.readFileSync(file));
    }
    res.writeHead(404).end("not found");
  } catch (e) {
    res.writeHead(500).end(String(e && e.message ? e.message : e));
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log("Landing           → http://127.0.0.1:" + PORT + "/");
  console.log("Sales History     → http://127.0.0.1:" + PORT + "/sales-history");
  console.log("Operator (demo)   → http://127.0.0.1:" + PORT + "/operator");
});
