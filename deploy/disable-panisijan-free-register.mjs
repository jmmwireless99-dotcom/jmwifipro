/**
 * PANISIJAN (router 51) — skip create-account / registration.
 * Clients still claim free internet once per day; no name/CP form.
 *
 * Usage on VPS:
 *   cd /opt/jm-billing && node deploy/disable-panisijan-free-register.mjs
 *   systemctl restart jm-billing
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DB = process.env.BILLING_DB || path.join(ROOT, "billing.db");
const ROUTER_ID = 51;

const files = [
  ["lib/kitifi-free-claim-policy.js", "lib/kitifi-free-claim-policy.js"],
  ["lib/kitifi-free-wifi.js", "lib/kitifi-free-wifi.js"],
  ["public/kitifi/free-internet.html", "public/kitifi/free-internet.html"],
  ["public/hotspot/panisijan-login.html", "public/hotspot/panisijan-login.html"],
];

for (const [srcRel, destRel] of files) {
  const src = path.join(ROOT, srcRel);
  const dest = path.join(ROOT, destRel);
  if (!fs.existsSync(src)) throw new Error("Missing " + src);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (path.resolve(src) !== path.resolve(dest)) fs.copyFileSync(src, dest);
  console.log("ok", destRel);
}

if (fs.existsSync(DB)) {
  const db = new DatabaseSync(DB);
  const upsert = db.prepare("INSERT INTO settings (k,v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v");
  upsert.run("kitifi_free_skip_register_" + ROUTER_ID, "1");
  upsert.run("kitifi_free_enabled_" + ROUTER_ID, "1");
  console.log("setting kitifi_free_skip_register_" + ROUTER_ID + "=1");
} else {
  console.log("DB not found (ok if copying files only):", DB);
}

const serverPath = path.join(ROOT, "server.js");
if (fs.existsSync(serverPath)) {
  let src = fs.readFileSync(serverPath, "utf8");
  const old = 'if (!st.registered) throw new Error("Register first before claiming free WiFi.");';
  const next =
    'if (!st.registered && Number(rid) !== 51) throw new Error("Register first before claiming free WiFi.");';
  if (src.includes(old)) {
    src = src.split(old).join(next);
    fs.writeFileSync(serverPath, src);
    console.log("patched server.js claim register-gate (router 51 skip)");
  } else if (src.includes("Number(rid) !== 51") && src.includes("Register first")) {
    console.log("server.js already skips register on router 51");
  } else {
    console.log("server.js: no inline register-first gate (uses lib)");
  }
}

console.log("\nPANISIJAN free WiFi: claim only — no create account / registration form.");
console.log("Restart: systemctl restart jm-billing");
console.log("Then re-upload portal: node deploy/fix-panisijan-captive-portal.mjs");
