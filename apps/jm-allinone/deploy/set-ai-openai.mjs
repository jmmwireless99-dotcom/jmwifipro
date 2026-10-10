import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync("/opt/jm-billing/billing.db");
db.prepare("INSERT INTO settings (k,v) VALUES ('ai_provider','openai') ON CONFLICT(k) DO UPDATE SET v='openai'").run();
console.log("ai_provider set to openai");
