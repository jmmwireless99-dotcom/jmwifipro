// Diagnose MikroTik sync on VPS
import { DatabaseSync } from "node:sqlite";

const DB = process.argv[2] || "/opt/jm-billing/billing.db";
const db = new DatabaseSync(DB);

const keys = ["mikrotik_host", "mikrotik_user", "mikrotik_port", "suspended_profile", "dry_run", "auto_suspend", "expiry_check_mins"];
console.log("settings:");
for (const k of keys) {
  const r = db.prepare("SELECT v FROM settings WHERE k=?").get(k);
  console.log(" ", k, "=", r?.v ?? "(unset)");
}

console.log("\nrouters:");
for (const r of db.prepare("SELECT id,name,host,port,username,enabled,is_default,last_status FROM routers").all()) {
  console.log(" ", JSON.stringify(r));
}

console.log("\nrecent suspend audit:");
const audit = db.prepare(`
  SELECT id, at, action, detail, ok, customer_name FROM audit
  WHERE action IN ('suspend','reconnect','provision') OR detail LIKE '%profile%'
  ORDER BY id DESC LIMIT 20
`).all();
for (const row of audit) console.log(" ", JSON.stringify(row));

console.log("\nactive customers still online candidates (suspended in DB):");
const sus = db.prepare(`
  SELECT c.id,c.name,c.username,c.status,c.expiry,c.router_id,p.router_profile
  FROM customers c LEFT JOIN plans p ON p.id=c.plan_id
  WHERE c.status='suspended' AND trim(c.username)<>''
  LIMIT 10
`).all();
console.log(JSON.stringify(sus, null, 2));
