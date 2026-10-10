// lib/ai.js
// Natural-language → structured MikroTik commands, helpdesk drafts, digests, and customer chat.
// Supports OpenAI, Google Gemini, and Anthropic — chosen in Settings (ai_provider).

const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.0-flash";

let _cfgProvider = () => ({
  apiKey: process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY || "",
  model: process.env.GEMINI_MODEL || process.env.OPENAI_MODEL || process.env.ANTHROPIC_MODEL || GEMINI_MODEL,
  enabled: !!(process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY),
  provider: process.env.GEMINI_API_KEY ? "gemini" : process.env.OPENAI_API_KEY ? "openai" : "anthropic",
  base: process.env.GEMINI_API_KEY
    ? (process.env.GEMINI_BASE || "https://generativelanguage.googleapis.com")
    : process.env.OPENAI_API_KEY
      ? (process.env.OPENAI_BASE || "https://api.openai.com")
      : (process.env.AI_BASE || "https://api.anthropic.com"),
});
export function setAiConfigProvider(fn) { if (typeof fn === "function") _cfgProvider = fn; }
function aiCfg() { try { return _cfgProvider() || {}; } catch { return {}; } }

function resolveProvider(cfg) {
  const p = String(cfg.provider || process.env.AI_PROVIDER || "").toLowerCase();
  if (p === "openai" || p === "anthropic" || p === "gemini") return p;
  const key = String(cfg.apiKey || "");
  if (key.startsWith("AIza")) return "gemini";
  if (key.startsWith("sk-ant-")) return "anthropic";
  if (key.startsWith("sk-proj-") || (key.startsWith("sk-") && !key.startsWith("sk-ant-"))) return "openai";
  if (process.env.GEMINI_API_KEY) return "gemini";
  if (process.env.OPENAI_API_KEY) return "openai";
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  return "gemini";
}

function defaultModel(provider) {
  if (provider === "anthropic") return ANTHROPIC_MODEL;
  if (provider === "gemini") return GEMINI_MODEL;
  return OPENAI_MODEL;
}

function apiBase(cfg, provider) {
  if (provider === "gemini") {
    return cfg.base && String(cfg.base).includes("googleapis.com")
      ? cfg.base.replace(/\/$/, "")
      : (process.env.GEMINI_BASE || "https://generativelanguage.googleapis.com");
  }
  if (provider === "openai") {
    return cfg.base && !String(cfg.base).includes("anthropic.com") && !String(cfg.base).includes("googleapis.com")
      ? cfg.base
      : (process.env.OPENAI_BASE || "https://api.openai.com");
  }
  return cfg.base && String(cfg.base).includes("anthropic.com")
    ? cfg.base
    : (process.env.AI_BASE || "https://api.anthropic.com");
}

export const ALLOWED_ACTIONS = {
  list_pppoe: [],
  list_pppoe_active: [],
  create_pppoe: ["name", "password", "profile", "comment"],
  enable_pppoe: ["name"],
  disable_pppoe: ["name"],
  delete_pppoe: ["name"],
  disconnect_pppoe: ["name"],
  list_hotspot_users: [],
  list_hotspot_active: [],
  create_hotspot_user: ["name", "password", "profile", "limitUptime"],
  enable_hotspot_user: ["name"],
  disable_hotspot_user: ["name"],
  delete_hotspot_user: ["name"],
  disconnect_hotspot: ["user"],
  list_hotspot_profiles: [],
  create_hotspot_profile: ["name", "rateLimit", "sharedUsers", "sessionTimeout"],
  list_pppoe_profiles: [],
  sync_config: [],
  system_resource: [],
  interface_traffic: [],
};

const SYSTEM_PROMPT = `You are a command parser for a MikroTik RouterOS v7 control panel.
Convert the user's instruction into ONE JSON object describing the intended action.

Respond with JSON ONLY. No prose, no markdown, no code fences. Shape:
{ "action": "<action>", "params": { ... }, "explanation": "<one short sentence for the operator>" }

Allowed actions and their params:
- list_pppoe                 {}                         -> list all PPPoE accounts
- list_pppoe_active          {}                         -> list live PPPoE sessions
- create_pppoe               {name, password, profile?, comment?}
- enable_pppoe               {name}
- disable_pppoe              {name}                      -> suspend an account
- delete_pppoe               {name}
- disconnect_pppoe           {name}                      -> kick a live session, keep account
- list_hotspot_users         {}
- list_hotspot_active        {}
- create_hotspot_user        {name, password?, profile?, limitUptime?}  (limitUptime like "1d", "6h", "30m")
- enable_hotspot_user        {name}
- disable_hotspot_user       {name}
- delete_hotspot_user        {name}
- disconnect_hotspot         {user}
- list_hotspot_profiles      {}                          -> list hotspot user profiles ("packages")
- create_hotspot_profile     {name, rateLimit?, sharedUsers?, sessionTimeout?}  (rateLimit like "5M/5M", sessionTimeout like "1d")
- list_pppoe_profiles        {}                          -> list PPP profiles
- sync_config                {}                          -> pull a full snapshot of ALL router config, info and users
- system_resource            {}                          -> CPU, memory, uptime
- interface_traffic          {}                          -> per-interface throughput

Rules:
- Pick exactly ONE action. If the instruction is ambiguous, unsupported, or
  unsafe, use action "unknown" with an explanation telling the operator what to clarify.
- Never invent passwords unless the user clearly wants a new account and gives none;
  in that case set "password" to "" and mention it in the explanation.
- "kick"/"disconnect" maps to disconnect_*, NOT delete_*. "remove"/"delete" maps to delete_*.
- "suspend"/"block"/"freeze" maps to disable_*. "unblock"/"resume" maps to enable_*.
- Keep "explanation" under 20 words.`;

async function callAnthropic({ system, user, maxTokens, messages }) {
  const cfg = aiCfg();
  const provider = resolveProvider(cfg);
  if (provider !== "anthropic") throw new Error("Anthropic provider not selected.");
  if (!cfg.enabled || !cfg.apiKey) throw new Error("AI is turned off. Enable it and add your API key in Settings.");

  const body = messages
    ? {
        model: cfg.model || defaultModel("anthropic"),
        max_tokens: maxTokens,
        system,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
      }
    : {
        model: cfg.model || defaultModel("anthropic"),
        max_tokens: maxTokens,
        system,
        messages: [{ role: "user", content: user }],
      };

  const res = await fetch(apiBase(cfg, "anthropic") + "/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": cfg.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Anthropic API error (${res.status}): ${json?.error?.message || JSON.stringify(json)}`);
  }
  return (json.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}

async function callOpenAI({ system, user, maxTokens, messages }) {
  const cfg = aiCfg();
  const provider = resolveProvider(cfg);
  if (provider !== "openai") throw new Error("OpenAI provider not selected.");
  if (!cfg.enabled || !cfg.apiKey) throw new Error("AI is turned off. Enable it and add your API key in Settings.");

  const msgs = messages
    ? [{ role: "system", content: system }, ...messages.map((m) => ({ role: m.role, content: m.content }))]
    : [
        { role: "system", content: system },
        { role: "user", content: user },
      ];

  const res = await fetch(apiBase(cfg, "openai") + "/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({
      model: cfg.model || defaultModel("openai"),
      max_tokens: maxTokens,
      messages: msgs,
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`OpenAI API error (${res.status}): ${json?.error?.message || JSON.stringify(json)}`);
  }
  return String(json.choices?.[0]?.message?.content || "").trim();
}

function geminiRole(role) {
  return role === "assistant" ? "model" : "user";
}

async function callGemini({ system, user, maxTokens, messages }) {
  const cfg = aiCfg();
  const provider = resolveProvider(cfg);
  if (provider !== "gemini") throw new Error("Gemini provider not selected.");
  if (!cfg.enabled || !cfg.apiKey) throw new Error("AI is turned off. Enable it and add your API key in Settings.");

  const model = (cfg.model || defaultModel("gemini")).replace(/^models\//, "");
  const url = `${apiBase(cfg, "gemini")}/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(cfg.apiKey)}`;

  const contents = messages
    ? messages.map((m) => ({
        role: geminiRole(m.role),
        parts: [{ text: String(m.content || "") }],
      }))
    : [{ role: "user", parts: [{ text: user }] }];

  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      systemInstruction: system ? { parts: [{ text: system }] } : undefined,
      contents,
      generationConfig: { maxOutputTokens: maxTokens },
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = json?.error?.message || json?.error?.status || JSON.stringify(json);
    throw new Error(`Gemini API error (${res.status}): ${err}`);
  }
  const parts = json.candidates?.[0]?.content?.parts || [];
  return parts.map((p) => p.text || "").join("").trim();
}

async function callLlm(opts) {
  const provider = resolveProvider(aiCfg());
  if (provider === "openai") return callOpenAI(opts);
  if (provider === "gemini") return callGemini(opts);
  return callAnthropic(opts);
}

export async function parseCommand(instruction) {
  const raw = await callLlm({ system: SYSTEM_PROMPT, user: instruction, maxTokens: 400 });
  const clean = raw.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();

  let parsed;
  try {
    parsed = JSON.parse(clean);
  } catch {
    throw new Error(`Could not parse AI output as JSON: ${raw}`);
  }

  if (parsed.action === "unknown") {
    return { ok: false, reason: parsed.explanation || "Could not understand the request." };
  }
  if (!(parsed.action in ALLOWED_ACTIONS)) {
    return { ok: false, reason: `AI returned a non-whitelisted action: ${parsed.action}` };
  }

  const allowedKeys = ALLOWED_ACTIONS[parsed.action];
  const params = {};
  for (const k of allowedKeys) {
    if (parsed.params && parsed.params[k] !== undefined) params[k] = parsed.params[k];
  }
  return { ok: true, action: parsed.action, params, explanation: parsed.explanation || "" };
}

export function aiEnabled() {
  const c = aiCfg();
  return !!(c.enabled && c.apiKey);
}

export function aiProvider() {
  return resolveProvider(aiCfg());
}

/** Customer-safe message — hides raw API keys / quota errors from the public chat widget. */
export function friendlyChatError(err) {
  const msg = String(err?.message || err || "");
  if (/429|quota|exceeded|billing|insufficient/i.test(msg)) {
    return "Our chat assistant is temporarily unavailable. Please use Help & Support or contact us — we'll reply soon.";
  }
  if (/401|403|invalid.*api|incorrect api key|authentication/i.test(msg)) {
    return "Chat is being set up. Please use Help & Support for now.";
  }
  if (/rate limit|too many requests/i.test(msg)) {
    return "Too many messages right now. Please wait a minute and try again.";
  }
  return "Sorry, I couldn't answer that. Please try again or submit a help ticket.";
}

async function aiText(system, user, maxTokens = 500) {
  return callLlm({ system, user, maxTokens });
}

export async function draftReply({ bizName, customerName, category, message, language }) {
  const system = `You are a friendly customer-support agent for "${bizName || "a Philippine internet provider"}", a small WISP/piso-WiFi ISP in the Philippines.
Write a SHORT reply (max 2 sentences, under 320 characters) suitable for SMS.
Match the customer's language: if they wrote in Tagalog/Taglish, reply in warm conversational Tagalog; if English, reply in English.
Be polite, concrete, and reassuring. Do NOT promise specific refund amounts, exact restoration times, or make commitments you cannot keep. Do NOT invent account details.
If it is a no-internet/outage complaint, acknowledge and say it is being checked. If billing, explain politely how to pay or that you will verify. Sign off with the business name.
Reply with ONLY the message text — no quotes, no preamble.`;
  const user = `Customer: ${customerName || "(unknown)"}
Topic: ${category || "general"}
Their message: "${message || ""}"
${language ? "Preferred language: " + language : ""}`;
  return aiText(system, user, 300);
}

export async function dailyDigest(facts) {
  const system = `You are an operations assistant for a small Philippine ISP. Given today's numbers and events, write a brief, plain-language end-of-day digest for the owner.
Use 4-6 short bullet points. Highlight what needs attention (overdue payers, outages, offline vendos, anomalies) and end with a one-line suggestion of what to follow up tomorrow. Keep it under 120 words. No fluff.`;
  return aiText(system, JSON.stringify(facts), 400);
}

export async function customerChat({ message, history = [], bizName, publicUrl, bizContact, gcashName }) {
  const portal = String(publicUrl || "https://jmwifi.pro").replace(/\/$/, "");
  const system = `You are a helpful customer support chatbot for "${bizName || "a Philippine internet provider"}" (WISP/PPPoE ISP in the Philippines).
Answer questions about:
- Paying bills (GCash/Maya QR Ph at ${portal}/account or ${portal}/pay)
- Checking account balance and due date (${portal}/account)
- Applying for new service (${portal}/apply)
- No internet / slow connection (check modem power, account expiry, ask them to reboot router; offer to escalate)
- Suspended accounts (pay to reconnect via the portal)

Rules:
- Keep replies short: 2-4 sentences.
- Match Tagalog/Taglish if the customer writes that way; otherwise English.
- Do NOT invent account balances, usernames, or payment amounts.
- Do NOT promise exact restoration times.
- If you cannot resolve it, suggest they submit a help ticket at ${portal}/help${bizContact ? " or contact " + bizContact : ""}.
${gcashName ? "GCash account name for manual payment: " + gcashName + "." : ""}`;

  const trimmed = (history || [])
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && m.content)
    .slice(-10)
    .map((m) => ({ role: m.role, content: String(m.content).slice(0, 2000) }));

  return callLlm({
    system,
    maxTokens: 400,
    messages: [...trimmed, { role: "user", content: String(message || "").slice(0, 2000) }],
  });
}

/** Rule-based chat when AI billing/quota fails — no API key or payment needed. */
export function faqChatReply({ message, bizName, publicUrl, bizContact, gcashName, gcashNumber }) {
  const portal = String(publicUrl || "https://jmwifi.pro").replace(/\/$/, "");
  const biz = bizName || "JM WIFI";
  const m = String(message || "").toLowerCase();
  const tagalog = /^(magandang|mabuhay|kumusta|paano|saan|wala|bayad|mag|ano|pwd|password|account|apply|help|support|internet|wifi|gcash|maya|suspend|expire|reconnect|balance|due|bill)/.test(m)
    || /\b(po|nga|naman|ko|ba|mga|wala|paano|saan|magbayad|account|internet|wifi|gcash)\b/.test(m);

  const contact = bizContact ? ` You can also reach us at ${bizContact}.` : "";
  const gcash = gcashName || gcashNumber
    ? (gcashName && gcashNumber ? ` GCash: ${gcashName} (${gcashNumber}).` : gcashName ? ` GCash name: ${gcashName}.` : ` GCash number: ${gcashNumber}.`)
    : "";

  if (/^(hi|hello|hey|good morning|good afternoon|good evening|magandang)/.test(m)) {
    return tagalog
      ? `Magandang araw! Ako ang chat assistant ng ${biz}. Makakatulong ako sa bayad, account, at connection. Ano ang kailangan mo?`
      : `Hello! I'm the ${biz} chat assistant. I can help with payments, your account, and connection issues. How can I help?`;
  }
  if (/pay|bayad|gcash|maya|qr|bill|invoice|magbayad|payment|top.?up|wallet/.test(m)) {
    return tagalog
      ? `Para magbayad: buksan ${portal}/account (sign in) o ${portal}/pay. Pwede QR Ph via GCash/Maya — auto-reconnect pag na-verify ang bayad.${gcash}${contact}`
      : `To pay: open ${portal}/account (sign in) or ${portal}/pay. You can scan QR Ph with GCash/Maya — your connection restores automatically once payment is confirmed.${gcash}${contact}`;
  }
  if (/account|login|password|pwd|sign in|username|balance|due|expir|expiry|plan/.test(m)) {
    return tagalog
      ? `Sign in sa ${portal}/account gamit ang PPPoE username at portal password mo. Makikita mo doon ang due date, plan, at balance. Kung walang password, i-message kami.${contact}`
      : `Sign in at ${portal}/account with your PPPoE username and portal password. You'll see your due date, plan, and balance. No password yet? Contact us.${contact}`;
  }
  if (/apply|install|new|signup|sign up|application|magpa.?install|connection/.test(m)) {
    return tagalog
      ? `Mag-apply para sa bagong connection dito: ${portal}/apply. Punan ang form at susundin ka namin sa installation.`
      : `Apply for new service here: ${portal}/apply. Fill out the form and we'll follow up for installation.`;
  }
  if (/no internet|wala.*internet|walang net|slow|down|offline|disconnect|connected|los|no signal|patay/.test(m)) {
    return tagalog
      ? `Subukan muna: (1) i-reboot ang router/modem, (2) check kung expired/suspended ang account sa ${portal}/account, (3) kung tuloy pa rin, mag-submit ng ticket sa ${portal}/help.${contact}`
      : `Try this: (1) reboot your router/modem, (2) check if your account expired at ${portal}/account, (3) if still down, submit a ticket at ${portal}/help.${contact}`;
  }
  if (/suspend|blocked|expired|reconnect|restore|resume|putol/.test(m)) {
    return tagalog
      ? `Kung suspended/expired ang account, magbayad sa ${portal}/account (QR Ph o proof upload). Karaniwang auto-reconnect pag na-post ang bayad.`
      : `If your account is suspended or expired, pay at ${portal}/account (QR Ph or upload proof). Service usually reconnects automatically after payment.`;
  }
  if (/help|support|ticket|tulong|assist|contact|call|number/.test(m)) {
    return tagalog
      ? `Para sa tulong, mag-submit sa ${portal}/help — sasagutin ka namin.${contact}`
      : `For help, submit a ticket at ${portal}/help — we'll get back to you.${contact}`;
  }
  return tagalog
    ? `Salamat sa mensahe! Para sa bayad: ${portal}/account · Bagong apply: ${portal}/apply · Tulong: ${portal}/help.${contact}`
    : `Thanks for your message! Pay bills: ${portal}/account · New apply: ${portal}/apply · Help: ${portal}/help.${contact}`;
}
