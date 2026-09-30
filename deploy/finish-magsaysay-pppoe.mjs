/**
 * Finish MAGSAYSAY-PPPOE after Candelaria clone:
 * - Bind WAN masquerade to sfp-sfpplus1
 * - Ensure DNS allow-remote-requests + 8.8.8.8/8.8.4.4
 * - Clamp TCP MSS (mangle + PPP profiles)
 * - Disable DHCP server on WAN (MAGSAY2X owns 192.168.17.0/24)
 * - Re-check PPPoE server on bridge-OUT
 *
 * Does NOT copy /ppp/secret.
 *
 * Usage on VPS:
 *   BILLING_DB=/opt/jm-billing/billing.db node deploy/finish-magsaysay-pppoe.mjs
 *   node deploy/apply-suspend-firewall.mjs MAGSAYSAY-PPPOE sfp-sfpplus1
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { MAGSAY_ROUTER_NAME, MAGSAY_WAN, MAG_PPPOE_IFACE, PROFILE_NAMES } from "../lib/magsay-clone-pppoe.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DB = process.env.BILLING_DB || path.join(ROOT, "billing.db");
const DRY = process.argv.includes("--dry-run");
const WAN = process.env.MAG_WAN || MAGSAY_WAN;
const PPPOE_IFACE = process.env.MAG_PPPOE_IFACE || MAG_PPPOE_IFACE;

async function loadApi() {
  const { RouterOSAPI } = await import("../lib/routeros-api.js");
  return RouterOSAPI;
}

function rowFromDb(db, name) {
  return (
    db.prepare("SELECT * FROM routers WHERE name=? AND enabled=1 ORDER BY id LIMIT 1").get(name) ||
    db.prepare("SELECT * FROM routers WHERE name LIKE ? ORDER BY id LIMIT 1").get(`%${name}%`)
  );
}

async function connMag() {
  const API = await loadApi();
  const db = new DatabaseSync(DB);
  const row = rowFromDb(db, MAGSAY_ROUTER_NAME);
  if (!row) throw new Error(`Router ${MAGSAY_ROUTER_NAME} not found in ${DB}`);
  return new API({
    host: String(row.host).split(":")[0],
    user: row.username,
    password: row.password,
    port: Number(row.port) || 8728,
    ssl: !!row.ssl,
    timeout: 30000,
  });
}

async function ensureMasq(conn) {
  const nat = await conn.print("/ip/firewall/nat");
  const masq = nat.filter((n) => n.chain === "srcnat" && n.action === "masquerade");
  const hit = masq.find((n) => n["out-interface"] === WAN);
  if (hit) return { action: "ok", out: WAN };
  if (masq.length === 1 && !masq[0]["out-interface"] && !masq[0]["out-interface-list"]) {
    if (DRY) return { action: "would-bind", out: WAN };
    await conn.setById("/ip/firewall/nat", masq[0][".id"], {
      "out-interface": WAN,
      comment: "JM: WAN masquerade",
    });
    return { action: "bound", out: WAN };
  }
  if (DRY) return { action: "would-create", out: WAN };
  await conn.add("/ip/firewall/nat", {
    chain: "srcnat",
    action: "masquerade",
    "out-interface": WAN,
    comment: "JM: WAN masquerade",
  });
  return { action: "created", out: WAN };
}

async function ensureDns(conn) {
  const dns = (await conn.print("/ip/dns"))[0] || {};
  const need = {};
  if (String(dns.servers || "") !== "8.8.8.8,8.8.4.4") need.servers = "8.8.8.8,8.8.4.4";
  if (String(dns["allow-remote-requests"]) !== "true") need["allow-remote-requests"] = "true";
  if (!Object.keys(need).length) return { action: "ok", servers: dns.servers };
  if (DRY) return { action: "would-update", need };
  await conn.talk(["/ip/dns/set", ...Object.entries(need).map(([k, v]) => `=${k}=${v}`)]);
  return { action: "updated", need };
}

async function ensureMssMangle(conn) {
  const mangle = await conn.print("/ip/firewall/mangle");
  const hit = mangle.find((m) => m.action === "change-mss" && String(m.comment || "").includes("JM: clamp MSS"));
  if (hit) return { action: "ok" };
  if (DRY) return { action: "would-create" };
  await conn.add("/ip/firewall/mangle", {
    chain: "forward",
    protocol: "tcp",
    "tcp-flags": "syn",
    action: "change-mss",
    "new-mss": "clamp-to-pmtu",
    passthrough: "true",
    comment: "JM: clamp MSS",
  });
  return { action: "created" };
}

async function ensureProfileMss(conn) {
  const out = [];
  const profiles = await conn.print("/ppp/profile");
  for (const name of PROFILE_NAMES) {
    const p = profiles.find((x) => x.name === name);
    if (!p) {
      out.push({ name, action: "missing" });
      continue;
    }
    if (String(p["change-tcp-mss"]) === "yes") {
      out.push({ name, action: "ok" });
      continue;
    }
    if (DRY) {
      out.push({ name, action: "would-set-yes" });
      continue;
    }
    await conn.setById("/ppp/profile", p[".id"], { "change-tcp-mss": "yes" });
    out.push({ name, action: "set-yes" });
  }
  return out;
}

async function disableWanDhcp(conn) {
  const dhcp = await conn.print("/ip/dhcp-server");
  const out = [];
  for (const d of dhcp) {
    if (d.interface !== WAN) {
      out.push({ name: d.name, action: "skip", interface: d.interface });
      continue;
    }
    if (String(d.disabled) === "true") {
      out.push({ name: d.name, action: "already-disabled" });
      continue;
    }
    if (DRY) {
      out.push({ name: d.name, action: "would-disable" });
      continue;
    }
    await conn.setById("/ip/dhcp-server", d[".id"], { disabled: "true" });
    out.push({ name: d.name, action: "disabled" });
  }
  return out;
}

async function checkPppoe(conn) {
  const rows = await conn.print("/interface/pppoe-server/server");
  const srv = rows.find((r) => r.interface === PPPOE_IFACE) || rows[0];
  return {
    found: !!srv,
    interface: srv?.interface,
    disabled: srv?.disabled,
    authentication: srv?.authentication,
    oneSessionPerHost: srv?.["one-session-per-host"],
  };
}

async function main() {
  const mag = await connMag();
  const id = await mag.identity();
  const report = {
    identity: id.name || id,
    dry: DRY,
    wan: WAN,
    pppoeIface: PPPOE_IFACE,
    masq: await ensureMasq(mag),
    dns: await ensureDns(mag),
    mssMangle: await ensureMssMangle(mag),
    profileMss: await ensureProfileMss(mag),
    dhcp: await disableWanDhcp(mag),
    pppoe: await checkPppoe(mag),
    secretsUntouched: (await mag.print("/ppp/secret")).length,
  };
  console.log(JSON.stringify(report, null, 2));
  try {
    mag.close?.();
  } catch {}
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  main().catch((e) => {
    console.error(e.message || e);
    process.exit(1);
  });
}

export { main };
