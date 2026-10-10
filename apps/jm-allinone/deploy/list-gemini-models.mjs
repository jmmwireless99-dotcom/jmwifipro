import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync("/opt/jm-billing/billing.db");
const apiKey = db.prepare("SELECT v FROM settings WHERE k=?").get("ai_api_key")?.v || "";
const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`);
const json = await res.json().catch(() => ({}));
console.log("HTTP", res.status);
if (!res.ok) { console.log(json.error?.message || JSON.stringify(json)); process.exit(1); }
const names = (json.models || []).filter((m) => (m.supportedGenerationMethods || []).includes("generateContent")).map((m) => m.name.replace(/^models\//, ""));
console.log("Available models (" + names.length + "):", names.slice(0, 15).join(", "));
