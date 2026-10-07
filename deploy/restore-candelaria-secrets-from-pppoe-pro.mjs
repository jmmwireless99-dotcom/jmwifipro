/**
 * Restore PPPoE secrets onto CANDELARIA-PPPOE (#50) from PPPOE-PRO (#58).
 * Does NOT delete secrets on either router. Optional --kick-active removes
 * /ppp/active sessions only (never /ppp/secret).
 *
 * Usage on VPS:
 *   BILLING_DB=/opt/jm-billing/billing.db node deploy/restore-candelaria-secrets-from-pppoe-pro.mjs
 *   BILLING_DB=/opt/jm-billing/billing.db node deploy/restore-candelaria-secrets-from-pppoe-pro.mjs --kick-active
 */
import { DatabaseSync } from "node:sqlite";
import { RouterOSAPI } from "../lib/routeros-api.js";

const DRY = process.argv.includes("--dry-run");
const KICK = process.argv.includes("--kick-active");
const DB = process.env.BILLING_DB || "/opt/jm-billing/billing.db";
const db = new DatabaseSync(DB);

function row(id) {
  const r = db.prepare("SELECT * FROM routers WHERE id=?").get(id);
  if (!r) throw new Error("missing router "+id);
  return r;
}
async function conn(id) {
  const r = row(id);
  return new RouterOSAPI({
    host: String(r.host).split(":")[0],
    user: r.username,
    password: r.password,
    port: Number(r.port),
    timeout: 180000,
  });
}
function isPppoe(s) {
  const svc = String(s.service || "any").toLowerCase();
  return svc === "pppoe" || svc === "any" || svc === "";
}

async function ensureProfile(api, src) {
  if (!src?.name) return;
  if (src.name === "default" || src.name === "default-encryption") return;
  if (!src["remote-address"] || String(src["remote-address"]).includes(" ")) return;
  const attrs = {
    name: src.name,
    "rate-limit": src["rate-limit"] || "",
    "dns-server": src["dns-server"] || "",
    "address-list": src["address-list"] || "",
    "change-tcp-mss": src["change-tcp-mss"] || "yes",
    "only-one": src["only-one"] || "default",
    "local-address": src["local-address"] || "",
    "remote-address": src["remote-address"] || "",
  };
  const id = await api.findId("/ppp/profile", "name", src.name);
  if (id) { if (!DRY) await api.setById("/ppp/profile", id, attrs); return "updated"; }
  if (!DRY) await api.add("/ppp/profile", attrs);
  return "created";
}

async function ensurePool(api, name, ranges, comment) {
  const id = await api.findId("/ip/pool", "name", name);
  if (id) {
    if (!DRY) await api.setById("/ip/pool", id, { ranges, ...(comment ? { comment } : {}) });
    return "updated";
  }
  if (!DRY) await api.add("/ip/pool", { name, ranges, ...(comment ? { comment } : {}) });
  return "created";
}

const pro = await conn(58);
const cande = await conn(50);
console.log("PRO identity:", (await pro.identity()).name);
console.log("CANDE identity:", (await cande.identity()).name);

// Ensure pools + profiles on Candelaria first (needed for secrets)
const report = { dry: DRY, pools: 0, profiles: 0, restore: { created: 0, updated: 0, skipped: 0 }, errors: [], kicked: {} };
for (const p of await pro.print("/ip/pool")) {
  if (/^dhcp/i.test(p.name)) continue;
  try { await ensurePool(cande, p.name, p.ranges, p.comment || ""); report.pools++; }
  catch (e) { report.errors.push({ pool: p.name, error: String(e.message||e) }); }
}
for (const p of await pro.print("/ppp/profile")) {
  try {
    const a = await ensureProfile(cande, p);
    if (a) report.profiles++;
  } catch (e) {
    report.errors.push({ profile: p.name, error: String(e.message||e) });
  }
}

const proSecrets = (await pro.print("/ppp/secret")).filter(isPppoe);
const candeBefore = (await cande.print("/ppp/secret")).filter(isPppoe);
console.log("PRO secrets", proSecrets.length, "CANDE before", candeBefore.length);

const cust = db.prepare("SELECT username, password, status FROM customers WHERE router_id=50").all();
const custBy = Object.fromEntries(cust.map(c => [c.username, c]));
console.log("billing customers on router 50:", cust.length);

const byName = new Map(proSecrets.map(s => [s.name, s]));

// Build restore list: all billing cust50 from PRO, else billing password; plus from:CANDELARIA; if thin all PRO
const toRestore = new Map();
for (const c of cust) {
  const s = byName.get(c.username);
  if (s) toRestore.set(c.username, s);
  else if (c.password) {
    toRestore.set(c.username, {
      name: c.username,
      password: c.password,
      profile: c.status === "suspended" ? "suspended-pool" : "Home Fiber 999",
      service: "pppoe",
      disabled: "false",
      comment: "restored-from-billing",
    });
  }
}
for (const s of proSecrets) {
  if (/from:CANDELARIA/i.test(String(s.comment||""))) toRestore.set(s.name, s);
}
if (toRestore.size < 100) {
  console.log("WARN: few matches; restoring ALL PRO pppoe secrets");
  for (const s of proSecrets) toRestore.set(s.name, s);
}

console.log("toRestore", toRestore.size);

for (const s of toRestore.values()) {
  if (!s.password) { report.restore.skipped++; continue; }
  try {
    const existing = await cande.findId("/ppp/secret", "name", s.name);
    const attrs = {
      name: s.name,
      password: s.password,
      profile: s.profile || "default",
      service: s.service || "pppoe",
      disabled: "false",
    };
    if (s["caller-id"]) attrs["caller-id"] = s["caller-id"];
    if (s.comment) attrs.comment = String(s.comment).slice(0, 120);
    if (existing) {
      if (!DRY) await cande.setById("/ppp/secret", existing, attrs);
      report.restore.updated++;
    } else {
      if (!DRY) await cande.add("/ppp/secret", attrs);
      report.restore.created++;
    }
  } catch (e) {
    report.errors.push({ name: s.name, error: String(e.message||e) });
  }
}

// All PRO secrets stay; force-enable
let proEnabled = 0;
for (const s of proSecrets) {
  if (String(s.disabled) === "true") {
    if (!DRY) await pro.setById("/ppp/secret", s[".id"], { disabled: "false" });
    proEnabled++;
  }
}
report.proForceEnabled = proEnabled;
report.proSecretsKept = proSecrets.length;

if (KICK) {
  for (const [label, api] of [["cande", cande], ["pro", pro]]) {
    const active = await api.print("/ppp/active");
    let removed = 0;
    for (const a of active) {
      if (!a[".id"]) continue;
      if (!DRY) {
        try { await api.removeById("/ppp/active", a[".id"]); removed++; }
        catch (e) { console.warn("kick", label, a.name, e.message); }
      } else removed++;
    }
    report.kicked[label] = { total: active.length, removed };
  }
}

const candeAfter = (await cande.print("/ppp/secret")).filter(isPppoe);
const proAfter = (await pro.print("/ppp/secret")).filter(isPppoe);
const missing = cust.filter(c => !candeAfter.some(s => s.name === c.username)).map(c => c.username);
report.verify = {
  candelariaIdentity: (await cande.identity()).name,
  candelariaSecrets: candeAfter.length,
  candelariaDisabled: candeAfter.filter(s => String(s.disabled)==="true").length,
  pppoeProSecrets: proAfter.length,
  pppoeProDisabled: proAfter.filter(s => String(s.disabled)==="true").length,
  billingCust50: cust.length,
  missingOnCandeSample: missing.slice(0, 30),
  missingCount: missing.length,
  candelariaActive: (await cande.print("/ppp/active")).length,
  proActive: (await pro.print("/ppp/active")).length,
};

await cande.close?.();
await pro.close?.();
console.log(JSON.stringify(report, null, 2));
