import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync(process.argv[2] || "billing.db");
const keys = ["mikrotik_password", "mikrotik_host", "mikrotik_user", "public_url", "dry_run"];
for (const k of keys) {
  const r = db.prepare("SELECT v FROM settings WHERE k=?").get(k);
  console.log(k + ":", r?.v ? (k.includes("password") ? "(set, len " + r.v.length + ")" : r.v) : "(missing)");
}
