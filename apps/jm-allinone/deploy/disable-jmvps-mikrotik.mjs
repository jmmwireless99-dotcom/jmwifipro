#!/usr/bin/env node
/**
 * Pause / offline ALL MikroTik sites on this panel (jmvps).
 * Stops API polls + commands so jmwifi.pro stays the only live writer.
 *
 * Usage:
 *   node deploy/disable-jmvps-mikrotik.mjs [/path/to/billing.db]
 *   node deploy/disable-jmvps-mikrotik.mjs --enable [/path/to/billing.db]   # re-enable later
 */
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const enable = args.includes("--enable");
const dbPath = args.find((a) => !a.startsWith("--")) || path.resolve(__dirname, "../billing.db");
const flag = enable ? 1 : 0;

const db = new DatabaseSync(dbPath);
const before = db.prepare("SELECT id,name,enabled FROM routers ORDER BY id").all();
const r = db.prepare("UPDATE routers SET enabled=?").run(flag);
console.log("DB:", dbPath);
console.log(enable ? "RE-ENABLED" : "DISABLED/OFFLINE", "routers:", r.changes);
for (const row of before) {
  const after = db.prepare("SELECT enabled FROM routers WHERE id=?").get(row.id)?.enabled;
  console.log(`  #${row.id} ${row.name}: ${row.enabled} → ${after}`);
}
// Keep safe-mode flags when disabling
if (!enable) {
  const put = (k, v) => {
    const ex = db.prepare("SELECT v FROM settings WHERE k=?").get(k);
    if (ex) db.prepare("UPDATE settings SET v=? WHERE k=?").run(String(v), k);
    else db.prepare("INSERT INTO settings (k,v) VALUES (?,?)").run(k, String(v));
  };
  put("dry_run", "1");
  put("auto_suspend", "0");
  put("expiry_check_mins", "0");
  put("watchdog_mins", "0");
  put("sms_autoapprove", "0");
  console.log("Also kept SAFE MODE: dry_run=1, auto_suspend=0, expiry/watchdog off");
}
db.close();
console.log(enable
  ? "OK — routers can receive commands again (turn off dry_run in Settings if you want live writes)."
  : "OK — jmvps will not talk to MikroTik. jmwifi.pro remains the live panel.");
