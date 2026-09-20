/**
 * Public Free Installation apply page at /free/installation
 *
 * On VPS:
 *   cd /opt/jm-billing && node deploy/add-free-installation-page.mjs
 *   systemctl restart jm-billing
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { patchDbJs, patchIndexHtml, patchServerJs } from "../lib/free-installation-page.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function copyInto(rel) {
  const from = path.join(ROOT, rel);
  const to = path.join(ROOT, rel);
  if (!fs.existsSync(from)) {
    console.log("missing", rel);
    return false;
  }
  console.log("ok", rel);
  return true;
}

function apply(rel, patcher) {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) {
    console.log("skip (missing)", rel);
    return { ok: true, skipped: true };
  }
  const next = patcher(fs.readFileSync(p, "utf8"));
  const miss = Array.isArray(next.missing) ? next.missing : (next.missing ? ["snippet"] : []);
  if (miss.length) {
    console.warn("patch misses in", rel, ":", miss.join(", "));
    return { ok: false, missing: miss };
  }
  if (next.changed) {
    fs.writeFileSync(p, next.src);
    console.log("patched", rel);
  } else {
    console.log("already patched", rel);
  }
  return { ok: true };
}

function main() {
  copyInto("lib/free-installation-coverage.mjs");
  copyInto("public/portal/free-installation.html");
  const results = [
    apply("server.js", patchServerJs),
    apply("lib/db.js", patchDbJs),
    apply("public/index.html", patchIndexHtml),
  ];
  if (results.some((r) => !r.ok)) process.exit(1);
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) main();
