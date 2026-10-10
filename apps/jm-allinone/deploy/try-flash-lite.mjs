import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync("/opt/jm-billing/billing.db");
db.prepare("INSERT INTO settings (k,v) VALUES ('ai_model',?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").run("gemini-2.0-flash-lite");
const apiKey = db.prepare("SELECT v FROM settings WHERE k=?").get("ai_api_key")?.v || "";
const model = "gemini-2.0-flash-lite";
const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
const res = await fetch(url, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: "Say OK" }] }], generationConfig: { maxOutputTokens: 10 } }),
});
const json = await res.json().catch(() => ({}));
console.log(model, res.status, json.error?.message || (json.candidates?.[0]?.content?.parts?.[0]?.text || "ok"));
