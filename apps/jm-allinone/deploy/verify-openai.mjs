/**
 * Verify OpenAI/AI chat config on VPS — never prints the full API key.
 * Usage: node deploy/verify-openai.mjs
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
const provider = get(db, "ai_provider") || "openai";
let apiKey = get(db, "ai_api_key");
if (apiKey === "***") apiKey = process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY || "";
const model = get(db, "ai_model") || (provider === "openai" ? "gpt-4o-mini" : "claude-haiku-4-5-20251001");

const report = {
  ai_enabled: enabled,
  ai_provider: provider,
  ai_model: get(db, "ai_model") || "(default: " + model + ")",
  has_api_key: !!(apiKey && apiKey.length > 8),
  key_hint: apiKey ? apiKey.slice(0, 7) + "…" + apiKey.slice(-4) : "(none)",
};

console.log("Settings:", JSON.stringify(report, null, 2));

if (!enabled) {
  console.log("\nVERDICT: AI is OFF in Settings — enable it in the admin panel.");
  process.exit(1);
}
if (!apiKey) {
  console.log("\nVERDICT: No API key saved — paste your OpenAI key in Settings → AI Assistant.");
  process.exit(1);
}

async function testOpenAI() {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: provider === "openai" ? model : "gpt-4o-mini",
      max_tokens: 20,
      messages: [{ role: "user", content: "Reply with exactly: OK" }],
    }),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

async function testChatApi() {
  const res = await fetch("http://127.0.0.1:3000/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message: "test verify", history: [] }),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

async function testStatus() {
  const res = await fetch("http://127.0.0.1:3000/api/chat/status");
  return res.json().catch(() => ({}));
}

console.log("\n--- OpenAI API direct test ---");
try {
  const t = await testOpenAI();
  if (t.status === 200) {
    const reply = t.json.choices?.[0]?.message?.content || "";
    console.log("OK — OpenAI responded:", JSON.stringify(reply.trim()));
    console.log("Model used:", t.json.model || model);
  } else {
    const err = t.json?.error?.message || t.json?.error?.code || JSON.stringify(t.json);
    console.log("FAILED — HTTP", t.status + ":", err);
    if (t.status === 429) {
      console.log("\nVERDICT: Quota/billing issue — add credits at https://platform.openai.com/settings/organization/billing");
    } else if (t.status === 401) {
      console.log("\nVERDICT: Invalid API key — create a new key at https://platform.openai.com/api-keys");
    } else if (t.status === 404 && /model/i.test(String(err))) {
      console.log("\nVERDICT: Model name wrong — try gpt-4o-mini in Settings");
    }
    process.exit(1);
  }
} catch (e) {
  console.log("FAILED — network:", e.message);
  process.exit(1);
}

console.log("\n--- Local /api/chat/status ---");
const st = await testStatus();
console.log(JSON.stringify(st, null, 2));

console.log("\n--- Local /api/chat test ---");
const chat = await testChatApi();
console.log("HTTP", chat.status, JSON.stringify(chat.json, null, 2));

if (chat.json.ok && chat.json.reply) {
  console.log("\nVERDICT: Chat bot is WORKING end-to-end.");
} else {
  console.log("\nVERDICT: OpenAI works but /api/chat returned an issue — check server logs.");
}
