/**
 * Add Free Installation sidebar button + job queue on the operator panel.
 *
 * On VPS:
 *   cd /opt/jm-billing && node /path/to/deploy/add-free-installation-nav.mjs
 *   systemctl restart jm-billing
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { patchDbJs, patchIndexHtml, patchServerJs } from "../lib/free-installation-nav.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function apply(rel, patcher) {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) {
    console.log("skip (missing)", rel);
    return { ok: true, skipped: true };
  }
  const cur = fs.readFileSync(p, "utf8");
  const next = patcher(cur);
  if (next.missing && (Array.isArray(next.missing) ? next.missing.length : next.missing)) {
    const miss = Array.isArray(next.missing) ? next.missing.join(", ") : "snippet";
    console.warn("patch misses in", rel, ":", miss);
    return { ok: false, missing: miss };
  }
  if (next.changed) {
    fs.writeFileSync(p, next.src);
    console.log("patched", rel);
  } else {
    console.log("already patched", rel);
  }
  return { ok: true, changed: !!next.changed };
}

function main() {
  const results = [
    apply("public/index.html", patchIndexHtml),
    apply("lib/db.js", patchDbJs),
    apply("server.js", patchServerJs),
  ];
  if (results.some((r) => !r.ok)) process.exit(1);
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) main();
