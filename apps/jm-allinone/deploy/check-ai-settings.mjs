import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync("/opt/jm-billing/billing.db");
for (const k of ["ai_enabled", "ai_provider", "ai_model"]) {
  const r = db.prepare("SELECT v FROM settings WHERE k=?").get(k);
  console.log(k, "=", r?.v ?? "(unset)");
}
const pw = db.prepare("SELECT v FROM settings WHERE k='ai_api_key'").get();
console.log("ai_api_key =", pw?.v ? (pw.v === "***" ? "***" : "(set)") : "(empty)");
