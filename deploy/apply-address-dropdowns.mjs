/**
 * Restrict jmwifi.pro/apply to covered municipality → barangay lists.
 *
 * On VPS:
 *   cd /opt/jm-billing && node deploy/apply-address-dropdowns.mjs
 *   systemctl restart jm-billing
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const IMPORT_OLD = `import { JobOrders } from "./lib/db.js";`;
const IMPORT_NEW = `import { JobOrders } from "./lib/db.js";
import { resolveApplyCoverage, formatApplyAddress } from "./lib/apply-coverage.mjs";`;

export function patchApplyImport(src) {
  if (src.includes('from "./lib/apply-coverage.mjs"')) return { src, changed: false };
  if (!src.includes(IMPORT_OLD)) return { src, changed: false, missing: "import" };
  return { src: src.replace(IMPORT_OLD, IMPORT_NEW), changed: true };
}

const VALIDATE_OLD = `      if (!b.agreed) return send(res, 400, { ok: false, error: "Please read and tick the agreement to continue." });
      const s = Settings.all();`;
const VALIDATE_NEW = `      if (!b.agreed) return send(res, 400, { ok: false, error: "Please read and tick the agreement to continue." });
      const cov = resolveApplyCoverage(b.municipality, b.barangay);
      if (!cov.ok) return send(res, 400, { ok: false, error: cov.error });
      b.area = cov.barangay;
      b.address = formatApplyAddress(cov.municipality, cov.barangay, b.landmark);
      const s = Settings.all();`;

export function patchApplyValidate(src) {
  if (src.includes("resolveApplyCoverage(b.municipality, b.barangay)")) return { src, changed: false };
  if (!src.includes(VALIDATE_OLD)) return { src, changed: false, missing: "validate" };
  return { src: src.replace(VALIDATE_OLD, VALIDATE_NEW), changed: true };
}

export function patchServerJs(src) {
  let out = String(src || "");
  const missing = [];
  let changed = false;
  for (const step of [patchApplyImport, patchApplyValidate]) {
    const r = step(out);
    if (r.missing) missing.push(r.missing);
    out = r.src;
    if (r.changed) changed = true;
  }
  return { src: out, changed, missing };
}

function copyFile(rel) {
  const from = path.join(ROOT, rel);
  return fs.existsSync(from);
}

function main() {
  const serverPath = path.join(ROOT, "server.js");
  if (!fs.existsSync(serverPath)) {
    console.log("server.js not in this tree (ok on git-only checkout)");
  } else {
    const cur = fs.readFileSync(serverPath, "utf8");
    const next = patchServerJs(cur);
    if (next.missing.length) console.warn("server.js patch misses:", next.missing.join(", "));
    if (next.changed) {
      fs.writeFileSync(serverPath, next.src);
      console.log("patched server.js (apply coverage validation)");
    } else {
      console.log("server.js already patched or no matching snippets");
    }
  }
  for (const rel of ["lib/apply-coverage.mjs", "public/portal/apply.html"]) {
    console.log(copyFile(rel) ? "ok " + rel : "missing " + rel);
  }
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) main();
