/**
 * Verify AI chat config on VPS — supports gemini, openai, anthropic.
 */
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DB = process.env.BILLING_DB || path.join(ROOT, "billing.db");

function get(db, k) {
  return db.prepare("SELECT v FROM settings WHERE k=?").get(k)?.v ?? "";
}

const db = new DatabaseSync(DB);
const enabled = get(db, "ai_enabled") === "1";
const provider = get(db, "ai_provider") || "gemini";
let apiKey = get(db, "ai_api_key");
if (apiKey === "***") apiKey = "";
const modelSetting = get(db, "ai_model");
const model = modelSetting || (provider === "gemini" ? "gemini-2.0-flash" : provider === "openai" ? "gpt-4o-mini" : "claude-haiku-4-5-20251001");

console.log("Settings:", JSON.stringify({
  ai_enabled: enabled,
  ai_provider: provider,
  ai_model: modelSetting || "(default: " + model + ")",
  has_api_key: !!(apiKey && apiKey.length > 8),
  key_hint: apiKey ? apiKey.slice(0, 4) + "…" + apiKey.slice(-4) : "(none)",
}, null, 2));

if (!enabled || !apiKey) {
  console.log("\nVERDICT: AI off or no key saved.");
  process.exit(1);
}

async function testGemini() {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: "Reply with exactly: OK" }] }],
      generationConfig: { maxOutputTokens: 20 },
    }),
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

async function testOpenAI() {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, max_tokens: 20, messages: [{ role: "user", content: "Reply with exactly: OK" }] }),
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

async function testChatApi() {
  const res = await fetch("http://127.0.0.1:3000/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message: "Magandang umaga", history: [] }),
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

console.log("\n--- Provider API test (" + provider + ") ---");
const t = provider === "gemini" ? await testGemini() : provider === "openai" ? await testOpenAI() : null;
if (!t) {
  console.log("Skip direct test for anthropic — use /api/chat below.");
} else if (t.status === 200) {
  const reply = provider === "gemini"
    ? (t.json.candidates?.[0]?.content?.parts || []).map((p) => p.text).join("")
    : t.json.choices?.[0]?.message?.content || "";
  console.log("OK — responded:", JSON.stringify(String(reply).trim()));
} else {
  const err = t.json?.error?.message || JSON.stringify(t.json?.error || t.json);
  console.log("FAILED — HTTP", t.status + ":", err);
  if (provider === "gemini" && (t.status === 400 || t.status === 403)) {
    console.log("\nVERDICT: Key may be wrong type — get AI Studio key (starts AIza…) at https://aistudio.google.com/apikey");
  }
  process.exit(1);
}

console.log("\n--- /api/chat test ---");
const chat = await testChatApi();
console.log("HTTP", chat.status);
if (chat.json.reply) console.log("Reply:", chat.json.reply.slice(0, 200));
console.log(chat.json.ok ? "\nVERDICT: Chat bot WORKING." : "\nVERDICT: Chat issue — " + (chat.json.error || "unknown"));
