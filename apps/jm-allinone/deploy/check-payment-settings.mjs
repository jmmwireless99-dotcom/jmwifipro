import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync("/opt/jm-billing/billing.db");
const keys = ["payment_gateway", "paymongo_secret", "paymongo_public", "xendit_secret", "public_url", "gcash_number", "gcash_name"];
for (const k of keys) {
  const r = db.prepare("SELECT v FROM settings WHERE k=?").get(k);
  const v = r && r.v != null ? String(r.v) : "";
  if (k.includes("secret")) console.log(k + ":", v ? "set (" + v.length + " chars)" : "NOT SET");
  else console.log(k + ":", v || "NOT SET");
}
