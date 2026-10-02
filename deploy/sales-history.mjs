/**
 * Install Sales History UI button + dashboard on jmwifi.pro.
 *
 * On VPS:
 *   cd /opt/jm-billing && node deploy/sales-history.mjs
 *   systemctl restart jm-billing
 *
 * Opens:
 *   https://jmwifi.pro/sales-history
 *   Landing nav "Sales History" button
 *   Operator sidebar "Sales History" button
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  patchLandingCss,
  patchLandingHtml,
  patchOperatorHtml,
} from "../lib/sales-history-nav.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const ROUTE_MARKER = 'pathname === "/sales-history"';

const ROUTE_SNIPPET = `    if (pathname === "/sales-history" && req.method === "GET") {
      try {
        const buf = fs.readFileSync(path.join(__dirname, "public", "sales-history.html"));
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
        return res.end(buf);
      } catch (e) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        return res.end("sales-history not found");
      }
    }
    if (pathname.startsWith("/lib/") && pathname.endsWith(".mjs") && req.method === "GET") {
      try {
        const safe = path.normalize(pathname.replace(/^\\/lib\\//, "")).replace(/^(\\.\\.[/\\\\])+/, "");
        const buf = fs.readFileSync(path.join(__dirname, "lib", safe));
        res.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-store" });
        return res.end(buf);
      } catch (e) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        return res.end("not found");
      }
    }
`;

/** Insert sales-history + /lib/*.mjs routes near /apply GET handler. */
export function patchServerJs(src) {
  let out = String(src || "");
  if (out.includes(ROUTE_MARKER)) return { src: out, changed: false };

  const anchor = 'if (pathname === "/apply" && req.method === "GET")';
  const idx = out.indexOf(anchor);
  if (idx < 0) return { src: out, changed: false, missing: "apply-route" };

  out = out.slice(0, idx) + ROUTE_SNIPPET + "\n    " + out.slice(idx);
  return { src: out, changed: true };
}

function copyRel(rel) {
  const from = path.join(ROOT, rel);
  const to = path.join(process.cwd(), rel);
  if (!fs.existsSync(from)) return false;
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  return true;
}

function applyFile(rel, patcher) {
  const p = path.join(process.cwd(), rel);
  if (!fs.existsSync(p)) {
    console.log("skip (missing)", rel);
    return { ok: true, skipped: true };
  }
  const cur = fs.readFileSync(p, "utf8");
  const next = patcher(cur);
  if (next.missing && (Array.isArray(next.missing) ? next.missing.length : next.missing)) {
    const miss = Array.isArray(next.missing) ? next.missing.join(", ") : String(next.missing);
    console.warn("patch misses in", rel, ":", miss);
  }
  if (next.changed) {
    fs.writeFileSync(p, next.src);
    console.log("patched", rel);
  } else {
    console.log("already patched or no match", rel);
  }
  return { ok: true, changed: !!next.changed };
}

function main() {
  const files = [
    "lib/apply-coverage.mjs",
    "lib/sales-history-data.mjs",
    "lib/sales-history.mjs",
    "lib/sales-history-nav.mjs",
    "public/sales-history.html",
    "public/landing/index.html",
    "public/isp-landing.css",
  ];
  for (const rel of files) {
    console.log(copyRel(rel) ? "copied " + rel : "missing " + rel);
  }

  // Operator panel (often public/index.html → /operator)
  applyFile("public/index.html", patchOperatorHtml);

  // Landing homepage candidates on VPS
  for (const rel of [
    "public/landing/index.html",
    "public/landing.html",
    "public/isp-landing.html",
    "public/home.html",
  ]) {
    applyFile(rel, patchLandingHtml);
  }
  applyFile("public/isp-landing.css", patchLandingCss);

  const serverPath = path.join(process.cwd(), "server.js");
  if (!fs.existsSync(serverPath)) {
    console.log("server.js not in cwd (ok on git-only checkout) — copy into /opt/jm-billing then re-run");
    return;
  }
  const cur = fs.readFileSync(serverPath, "utf8");
  const next = patchServerJs(cur);
  if (next.missing) console.warn("server.js patch miss:", next.missing);
  if (next.changed) {
    fs.writeFileSync(serverPath, next.src);
    console.log("patched server.js (/sales-history + /lib/*.mjs)");
  } else {
    console.log("server.js already patched or no matching snippets");
  }
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) main();
