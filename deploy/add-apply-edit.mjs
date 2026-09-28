/**
 * Enable client self-edit of pending /apply applications on the VPS.
 *
 * On VPS:
 *   cd /opt/jm-billing && node deploy/add-apply-edit.mjs
 *   systemctl restart jm-billing
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { patchApplyHtml, patchDbJs, patchServerJs } from "../lib/apply-edit.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function writeIfChanged(file, next, label) {
  if (!fs.existsSync(file)) {
    console.warn("missing", label, file);
    return false;
  }
  const cur = fs.readFileSync(file, "utf8");
  if (cur === next.src) {
    console.log("unchanged", label);
    return false;
  }
  if (next.missing && next.missing.length) {
    console.warn(label, "patch misses:", next.missing.join(", "));
  }
  if (!next.changed && next.missing && next.missing.length) return false;
  fs.writeFileSync(file, next.src);
  console.log("patched", label);
  return true;
}

function copyLib() {
  const from = path.join(ROOT, "lib/apply-edit.mjs");
  const to = path.join(ROOT, "lib/apply-edit.mjs");
  if (fs.existsSync(from)) console.log("ok lib/apply-edit.mjs");
  else console.warn("missing", to);
}

function main() {
  copyLib();
  const serverPath = path.join(ROOT, "server.js");
  if (fs.existsSync(serverPath)) {
    writeIfChanged(serverPath, patchServerJs(fs.readFileSync(serverPath, "utf8")), "server.js");
  } else {
    console.log("server.js not in this tree (ok on git-only checkout)");
  }
  const dbPath = path.join(ROOT, "lib/db.js");
  if (fs.existsSync(dbPath)) {
    writeIfChanged(dbPath, patchDbJs(fs.readFileSync(dbPath, "utf8")), "lib/db.js");
  } else {
    console.log("lib/db.js not in this tree (ok on git-only checkout)");
  }
  const htmlPath = path.join(ROOT, "public/portal/apply.html");
  if (fs.existsSync(htmlPath)) {
    writeIfChanged(htmlPath, patchApplyHtml(fs.readFileSync(htmlPath, "utf8")), "public/portal/apply.html");
  } else {
    console.warn("missing public/portal/apply.html");
  }
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) main();
