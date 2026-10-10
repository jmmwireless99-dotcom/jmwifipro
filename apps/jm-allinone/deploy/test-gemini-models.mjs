import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync("/opt/jm-billing/billing.db");
const apiKey = db.prepare("SELECT v FROM settings WHERE k=?").get("ai_api_key")?.v || "";
if (!apiKey) { console.log("no key"); process.exit(1); }
for (const model of ["gemini-1.5-flash", "gemini-2.0-flash-lite", "gemini-1.5-flash-8b", "gemini-2.0-flash"]) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: "Say OK" }] }],
      generationConfig: { maxOutputTokens: 10 },
    }),
  });
  const json = await res.json().catch(() => ({}));
  const text = (json.candidates?.[0]?.content?.parts || []).map((p) => p.text).join("") || json.error?.message || JSON.stringify(json.error);
  console.log(model, "→", res.status, String(text).slice(0, 120));
}
