#!/usr/bin/env node
/**
 * Safe mode for jmvps: view dashboard/data, but DO NOT write to MikroTik routers.
 * jmwifi.pro remains the live writer until cutover.
 *
 * Usage (on jmvps):
 *   node deploy/enable-jmvps-safe-mode.mjs [/path/to/billing.db]
 */
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = process.argv[2] || path.resolve(__dirname, "../billing.db");

const PATCH = {
  dry_run: "1",
  auto_suspend: "0",
  expiry_check_mins: "0",
  watchdog_mins: "0",
  sms_autoapprove: "0",
};

const db = new DatabaseSync(dbPath);
const get = (k) => db.prepare("SELECT v FROM settings WHERE k=?").get(k)?.v ?? null;
const put = (k, v) => {
  if (get(k) == null) db.prepare("INSERT INTO settings (k,v) VALUES (?,?)").run(k, v);
  else db.prepare("UPDATE settings SET v=? WHERE k=?").run(v, k);
};

console.log("DB:", dbPath);
for (const [k, v] of Object.entries(PATCH)) {
  const before = get(k);
  put(k, v);
  console.log(`  ${k}: ${before ?? "(missing)"} → ${get(k)}`);
}
db.close();
console.log("OK — restart jm-allinone so dry_run / automation reload.");
console.log("Safe mode:");
console.log("  • dry_run=1 → MikroTik WRITE commands logged only (not sent)");
console.log("  • auto_suspend=0 → daily collections OFF");
console.log("  • expiry_check_mins=0 → expiry sweep + reconcile OFF");
console.log("  • watchdog_mins=0 → watchdog OFF");
console.log("  • sms_autoapprove=0 → no auto renew from SMS");
console.log("Reads (status/health) still work. Live writer should remain jmwifi.pro until cutover.");
