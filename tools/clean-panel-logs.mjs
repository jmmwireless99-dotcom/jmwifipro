#!/usr/bin/env node
/**
 * Clean jmwifi.pro panel log/activity tables and fix empty legacy MikroTik settings.
 * Does NOT delete customers, plans, invoices, or payments.
 *
 * Usage on VPS:
 *   node tools/clean-panel-logs.mjs
 *   BILLING_DB=/opt/jm-billing/billing.db node tools/clean-panel-logs.mjs
 *
 * Also truncates nginx access/error logs when run as root on the VPS.
 */
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { execSync } from "node:child_process";

const DB = process.env.BILLING_DB || "/opt/jm-billing/billing.db";
const NGINX_LOGS = [
  "/var/log/nginx/access.log",
  "/var/log/nginx/error.log",
];

const LOG_TABLES = [
  "audit",
  "sms_messages",
  "usage_period",
  "usage_live",
  "customer_sessions",
  "coin_log_seen",
  "hotspot_events",
  "voucher_radius_sessions",
  "unit_events",
  "outages",
];

if (!fs.existsSync(DB)) {
  console.error("Database not found:", DB);
  process.exit(1);
}

const db = new DatabaseSync(DB);
const counts = {};
for (const t of LOG_TABLES) {
  try { counts[t] = db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n; } catch { counts[t] = null; }
}
console.log("Before:", counts);

const del = (sql, ...args) => db.prepare(sql).run(...args).changes || 0;
const cleared = {};
for (const t of LOG_TABLES) {
  try { cleared[t] = del(`DELETE FROM ${t}`); } catch (e) { cleared[t] = "skip: " + e.message; }
}

// Sync legacy mikrotik_* settings from default router (fixes "Router not configured" banner)
const def = db.prepare("SELECT id,host,port,username,password,ssl FROM routers WHERE is_default=1 AND enabled=1 LIMIT 1").get()
  || db.prepare("SELECT id,host,port,username,password,ssl FROM routers WHERE enabled=1 AND host<>'' ORDER BY id LIMIT 1").get();

// Fix known Candelaria main API user if still on old PPPOE-IPOE-MAIN label (password must match RouterOS)
if (process.env.MIKROTIK_USER && process.env.MIKROTIK_PASSWORD) {
  db.prepare("UPDATE routers SET username=?, password=? WHERE is_default=1 OR port=20494").run(process.env.MIKROTIK_USER, process.env.MIKROTIK_PASSWORD);
} else {
  db.prepare("UPDATE routers SET username='PPPOE-MAIN', password='PPPOE-MAIN' WHERE port=20494 AND username='PPPOE-IPOE-MAIN'").run();
}

if (def && def.host && def.username && def.password) {
  const set = db.prepare("INSERT INTO settings (k,v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v");
  set.run("mikrotik_host", def.host.split(":")[0]);
  set.run("mikrotik_port", String(def.port || 8728));
  set.run("mikrotik_user", def.username);
  set.run("mikrotik_password", def.password);
  set.run("mikrotik_ssl", def.ssl ? "1" : "0");
  console.log("Synced legacy mikrotik_* from router", def.host);
}

// Assign customers with no router to default router
const defId = db.prepare("SELECT id FROM routers WHERE is_default=1 AND enabled=1 LIMIT 1").get()?.id
  || db.prepare("SELECT id FROM routers WHERE enabled=1 AND host<>'' ORDER BY id LIMIT 1").get()?.id;
if (defId) {
  const n = del("UPDATE customers SET router_id=? WHERE router_id IS NULL", defId);
  console.log("Assigned", n, "customers with no router → router id", defId);
}

try { db.exec("VACUUM"); console.log("VACUUM ok"); } catch (e) { console.warn("VACUUM:", e.message); }

for (const f of NGINX_LOGS) {
  if (!fs.existsSync(f)) continue;
  try {
    fs.truncateSync(f, 0);
    console.log("Truncated", f);
  } catch (e) {
    console.warn("Could not truncate", f, e.message);
  }
}

try {
  execSync("journalctl --vacuum-time=1d 2>/dev/null || true", { stdio: "inherit" });
} catch {}

console.log("Cleared:", cleared);
console.log("Done. Restart panel: systemctl restart jm-billing");
