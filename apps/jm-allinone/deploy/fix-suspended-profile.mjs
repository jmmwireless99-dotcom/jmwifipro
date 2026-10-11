// Fix suspended_profile to match MikroTik PPP profile name
import { DatabaseSync } from "node:sqlite";

const DB = "/opt/jm-billing/billing.db";
const profile = process.argv[2] || "suspended-pool";
const db = new DatabaseSync(DB);
db.prepare("INSERT INTO settings (k,v) VALUES ('suspended_profile',?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").run(profile);
console.log("suspended_profile set to:", profile);
console.log("verify:", db.prepare("SELECT v FROM settings WHERE k='suspended_profile'").get());
