/**
 * Save MikroTik API credentials to billing DB (settings + routers row).
 * Usage:
 *   MIKROTIK_HOST=lazy3.kurifotremoteall.org MIKROTIK_PORT=20494 \
 *   MIKROTIK_USER=PPPOE-MAIN MIKROTIK_PASSWORD=secret \
 *   node deploy/set-mikrotik-creds.mjs [router-name]
 */
import { DatabaseSync } from "node:sqlite";
import { RouterOSAPI } from "../lib/routeros-api.js";

const DB = process.env.BILLING_DB || "/opt/jm-billing/billing.db";
const ROUTER_NAME = process.argv[2] || "Candelaria-Main";
const HOST = process.env.MIKROTIK_HOST || "";
const PORT = Number(process.env.MIKROTIK_PORT || 8728);
const USER = process.env.MIKROTIK_USER || "";
const PASS = process.env.MIKROTIK_PASSWORD || "";

if (!HOST || !USER || !PASS) {
  console.error("Set MIKROTIK_HOST, MIKROTIK_USER, MIKROTIK_PASSWORD");
  process.exit(1);
}

const db = new DatabaseSync(DB);
const set = db.prepare("INSERT INTO settings (k,v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v");

set.run("mikrotik_host", HOST);
set.run("mikrotik_port", String(PORT));
set.run("mikrotik_user", USER);
set.run("mikrotik_password", PASS);
set.run("mikrotik_ssl", "0");
console.log("Settings updated: host", HOST, "port", PORT, "user", USER);

let row = db.prepare("SELECT * FROM routers WHERE name=? OR name LIKE ? LIMIT 1").get(ROUTER_NAME, `%${ROUTER_NAME}%`);
if (!row) row = db.prepare("SELECT * FROM routers WHERE name LIKE '%PPPOE%' OR name LIKE '%Candelaria%' LIMIT 1").get();
if (row) {
  db.prepare("UPDATE routers SET name=?, host=?, port=?, username=?, password=?, enabled=1, is_default=1 WHERE id=?").run(
    "Candelaria-Main", HOST.split(":")[0], PORT, USER, PASS, row.id
  );
  console.log("Router id", row.id, "updated → Candelaria-Main");
} else {
  db.prepare("UPDATE routers SET is_default=0").run();
  const r = db.prepare(
    "INSERT INTO routers (name,host,port,username,password,ssl,enabled,is_default,vpn_notes) VALUES (?,?,?,?,?,0,1,1,?)"
  ).run("Candelaria-Main", HOST.split(":")[0], PORT, USER, PASS, "PPPOE-MAIN site");
  console.log("Router created id", r.lastInsertRowid);
}

const conn = new RouterOSAPI({ host: HOST.split(":")[0], user: USER, password: PASS, port: PORT, ssl: false, timeout: 20000 });
try {
  const ident = await conn.identity();
  console.log("API OK — identity:", ident.name || ident);
  const id = row?.id || db.prepare("SELECT id FROM routers WHERE name='Candelaria-Main'").get()?.id;
  if (id) {
    db.prepare("UPDATE routers SET last_status=?, last_seen=datetime('now','localtime') WHERE id=?").run("ok", id);
  }
  try { conn.close && conn.close(); } catch {}
} catch (e) {
  console.error("API test FAILED:", e.message);
  process.exit(1);
}
