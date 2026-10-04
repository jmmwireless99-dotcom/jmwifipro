/**
 * Clone CANDELARIA-PPPOE stack onto PPPOE-PRO and import PPPoE secrets
 * from both CANDELARIA-PPPOE and MAGSAY2X-CORE.
 *
 * Copies: pools, PPP profiles, mangle, JM firewall/NAT, address-lists, DNS,
 *         PPPoE server knobs, and all PPPoE secrets (Magasay wins on name clash).
 * Does NOT remove secrets from source routers.
 *
 * Usage on VPS:
 *   BILLING_DB=/opt/jm-billing/billing.db node deploy/clone-candelaria-and-magsay-to-pppoe-pro.mjs
 *   node deploy/apply-suspend-firewall.mjs PPPOE-PRO PPPOE-PRO
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DB = process.env.BILLING_DB || path.join(ROOT, "billing.db");
const DRY = process.argv.includes("--dry-run");
const PRO_NAME = "PPPOE-PRO";
const PRO_PPPOE_IFACE = process.env.PRO_PPPOE_IFACE || "sfp-sfpplus2";
const PRO_WAN = process.env.PRO_WAN || "PPPOE-PRO";

async function loadApi() {
  const { RouterOSAPI } = await import("../lib/routeros-api.js");
  return RouterOSAPI;
}

function rowByName(db, name) {
  return (
    db.prepare("SELECT * FROM routers WHERE name=? AND enabled=1 ORDER BY id LIMIT 1").get(name) ||
    db.prepare("SELECT * FROM routers WHERE name LIKE ? ORDER BY id LIMIT 1").get(`%${name}%`)
  );
}

async function conn(name) {
  const API = await loadApi();
  const db = new DatabaseSync(DB);
  const row = rowByName(db, name);
  if (!row) throw new Error(`Router ${name} not found`);
  return new API({
    host: String(row.host).split(":")[0],
    user: row.username,
    password: row.password,
    port: Number(row.port) || 8728,
    timeout: 180000,
  });
}

function isPppoeSecret(s) {
  const svc = String(s.service || "any").toLowerCase();
  return svc === "pppoe" || svc === "any" || svc === "";
}

function pick(obj, keys) {
  const o = {};
  for (const k of keys) if (obj[k] != null && obj[k] !== "") o[k] = obj[k];
  return o;
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

async function ensureProfile(api, src) {
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
  if (src.comment) attrs.comment = src.comment;
  const id = await api.findId("/ppp/profile", "name", src.name);
  if (id) {
    if (!DRY) await api.setById("/ppp/profile", id, attrs);
    return "updated";
  }
  if (!DRY) await api.add("/ppp/profile", attrs);
  return "created";
}

async function ensureSecret(api, src, tag) {
  if (!src.password) return "skip-no-pass";
  const existing = await api.findId("/ppp/secret", "name", src.name);
  const attrs = {
    name: src.name,
    password: src.password,
    profile: src.profile || "default",
    service: src.service || "pppoe",
    disabled: src.disabled === "true" ? "true" : "false",
  };
  if (src["caller-id"]) attrs["caller-id"] = src["caller-id"];
  const comment = [src.comment || "", tag].filter(Boolean).join(" | ");
  if (comment) attrs.comment = comment.slice(0, 120);
  if (existing) {
    if (!DRY) await api.setById("/ppp/secret", existing, attrs);
    return "updated";
  }
  if (!DRY) await api.add("/ppp/secret", attrs);
  return "created";
}

async function main() {
  const cande = await conn("CANDELARIA-PPPOE");
  const mag = await conn("MAGSAY2X-CORE");
  const pro = await conn(PRO_NAME);
  const report = { dry: DRY, pools: 0, profiles: 0, secrets: { created: 0, updated: 0 }, errors: [] };

  console.log("Source Candelaria:", (await cande.identity()).name);
  console.log("Source Magasay2x:", (await mag.identity()).name);
  console.log("Target:", (await pro.identity()).name, DRY ? "(dry-run)" : "");

  for (const p of await cande.print("/ip/pool")) {
    if (/^dhcp/i.test(p.name)) continue;
    await ensurePool(pro, p.name, p.ranges, p.comment || "");
    report.pools++;
  }
  for (const p of await cande.print("/ppp/profile")) {
    if (p.name === "default" || p.name === "default-encryption") continue;
    if (!p["remote-address"] || String(p["remote-address"]).includes(" ")) continue;
    try {
      await ensureProfile(pro, p);
      report.profiles++;
    } catch (e) {
      report.errors.push({ profile: p.name, error: e.message });
    }
  }

  const byName = new Map();
  for (const s of (await cande.print("/ppp/secret")).filter(isPppoeSecret)) byName.set(s.name, { ...s, _src: "CANDELARIA" });
  for (const s of (await mag.print("/ppp/secret")).filter(isPppoeSecret)) byName.set(s.name, { ...s, _src: "MAGSAY2X" });
  for (const s of byName.values()) {
    const a = await ensureSecret(pro, s, "from:" + s._src);
    if (a === "created") report.secrets.created++;
    if (a === "updated") report.secrets.updated++;
  }

  // PPPoE server
  const rows = await pro.print("/interface/pppoe-server/server");
  const attrs = {
    interface: PRO_PPPOE_IFACE,
    "service-name": "PPPOE-PRO",
    authentication: "pap,chap,mschap1,mschap2",
    "one-session-per-host": "true",
    "keepalive-timeout": "10",
    disabled: "false",
  };
  if (!DRY) {
    if (rows[0]) await pro.setById("/interface/pppoe-server/server", rows[0][".id"], attrs);
    else await pro.add("/interface/pppoe-server/server", attrs);
  }

  // Masquerade on WAN VLAN
  const nat = await pro.print("/ip/firewall/nat");
  if (!nat.some((n) => n.action === "masquerade") && !DRY) {
    await pro.add("/ip/firewall/nat", {
      chain: "srcnat",
      action: "masquerade",
      "out-interface": PRO_WAN,
      comment: "JM: WAN masquerade",
    });
  }

  await cande.close?.();
  await mag.close?.();
  await pro.close?.();
  console.log(JSON.stringify(report, null, 2));
  console.log("Next: node deploy/apply-suspend-firewall.mjs PPPOE-PRO " + PRO_WAN);
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  main().catch((e) => {
    console.error(e.message || e);
    process.exit(1);
  });
}
