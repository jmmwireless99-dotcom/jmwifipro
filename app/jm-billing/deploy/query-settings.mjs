import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync(process.argv[2] || "billing.db");
const keys = [
  "mikrotik_password", "mikrotik_host", "mikrotik_user", "mikrotik_port", "public_url", "dry_run",
  "hotspot_central", "cloud_hotspot_enabled", "radius_host", "radius_secret", "radius_port", "radius_acct_port",
];
for (const k of keys) {
  const r = db.prepare("SELECT v FROM settings WHERE k=?").get(k);
  console.log(k + ":", r?.v ? (k.includes("password") || k.includes("secret") ? "(set, len " + r.v.length + ")" : r.v) : "(missing/off)");
}
