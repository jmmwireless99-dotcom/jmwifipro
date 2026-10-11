import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync(process.argv[2] || "/opt/jm-billing/billing.db");
const r = db.prepare("SELECT v FROM settings WHERE k='mikrotik_password'").get();
const pw = r?.v || "";
console.log(JSON.stringify({
  has_password: !!(pw && pw !== "***"),
  password_masked: pw === "***" ? "***" : (pw ? "(set)" : "(empty)"),
  host: db.prepare("SELECT v FROM settings WHERE k='mikrotik_host'").get()?.v,
  port: db.prepare("SELECT v FROM settings WHERE k='mikrotik_port'").get()?.v,
  user: db.prepare("SELECT v FROM settings WHERE k='mikrotik_user'").get()?.v,
}));
