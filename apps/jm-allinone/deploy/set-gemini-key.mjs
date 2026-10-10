import { DatabaseSync } from "node:sqlite";
const key = process.argv[2] || process.env.GEMINI_KEY || "";
if (!key || key.length < 10) {
  console.error("Usage: node deploy/set-gemini-key.mjs <api-key>");
  process.exit(1);
}
const db = new DatabaseSync("/opt/jm-billing/billing.db");
db.prepare("INSERT INTO settings (k,v) VALUES ('ai_api_key',?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").run(key);
db.prepare("INSERT INTO settings (k,v) VALUES ('ai_provider','gemini') ON CONFLICT(k) DO UPDATE SET v='gemini'").run();
db.prepare("INSERT INTO settings (k,v) VALUES ('ai_enabled','1') ON CONFLICT(k) DO UPDATE SET v='1'").run();
console.log("OK — ai_provider=gemini, ai_enabled=1, key saved (" + key.slice(0, 4) + "…" + key.slice(-4) + ", len " + key.length + ")");
