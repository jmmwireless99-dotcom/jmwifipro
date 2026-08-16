/**
 * PANISIJAN router 51 — add-only GCash/PayMongo walled garden (safe for dynamic entries).
 * Usage on VPS:
 *   cd /opt/jm-billing && node deploy/apply-panisijan-gcash-walled-garden.mjs
 * Refresh (remove static JM rules first): add --refresh
 */
import dns from "node:dns/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { RouterOSAPI } from "../lib/routeros-api.js";
import { PAYMENT_HOSTS, CAPTIVE_HOSTS } from "../lib/payment-whitelist-hosts.js";

const ROUTER_ID = Number(process.env.ROUTER_ID || 51);
const PORTAL_HOST = process.env.PORTAL_HOST || "jmwifi.pro";
const DB = process.env.BILLING_DB || path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "billing.db");
const JM = "JM ";
const REFRESH = process.argv.includes("--refresh");
const RESOLVE_HOSTS = [
  PORTAL_HOST,
  "www.jmwifi.pro",
  "gcash.com",
  "payments.gcash.com",
  "api.mynt.xyz",
  "paymongo.com",
  "api.paymongo.com",
  "checkout.paymongo.com",
];

const db = new DatabaseSync(DB);
const row = db.prepare("SELECT * FROM routers WHERE id=?").get(ROUTER_ID);
if (!row) throw new Error("Router " + ROUTER_ID + " not found");

async function resolveHostIps(host) {
  const ips = new Set();
  try {
    for (const ip of await dns.resolve4(host)) ips.add(ip);
  } catch {}
  return [...ips];
}

function connFor(r) {
  return new RouterOSAPI({
    host: String(r.host).split(":")[0],
    user: r.username,
    password: r.password,
    port: Number(r.port) || 8728,
    ssl: !!r.ssl,
    timeout: 90000,
  });
}

async function maybeRefresh(conn) {
  if (!REFRESH) return 0;
  let n = 0;
  for (const pathName of ["/ip/hotspot/walled-garden", "/ip/hotspot/walled-garden/ip"]) {
    const rows = await conn.print(pathName);
    for (const e of rows || []) {
      const c = String(e.comment || "");
      if (!c.startsWith(JM)) continue;
      if (e.dynamic === "true" || e.dynamic === true) continue;
      try {
        await conn.talk([pathName + "/remove", "=.id=" + e[".id"]]);
        n++;
      } catch {}
    }
  }
  return n;
}

async function addHost(conn, host, comment, have) {
  const h = String(host || "").trim().toLowerCase();
  if (!h || have.has(h)) return false;
  have.add(h);
  if ((await conn.print("/ip/hotspot/walled-garden")).some((x) => String(x["dst-host"] || "").toLowerCase() === h)) {
    return false;
  }
  try {
    await conn.talk(["/ip/hotspot/walled-garden/add", "=dst-host=" + h, "=action=allow", "=comment=" + JM + comment]);
    return true;
  } catch (e) {
    console.log("  host skip", h, "—", (e.message || "").split(",")[0]);
    return false;
  }
}

async function addIp(conn, ip, comment, have, extra = {}) {
  const a = String(ip || "").trim();
  if (!a || a.includes(":") || have.has(a)) return false;
  have.add(a);
  const existing = await conn.print("/ip/hotspot/walled-garden/ip");
  if (existing.some((x) => String(x["dst-address"] || "").split("/")[0] === a)) return false;
  const args = ["/ip/hotspot/walled-garden/ip/add", "=dst-address=" + a, "=action=accept", "=comment=" + JM + comment];
  if (extra.protocol) args.push("=protocol=" + extra.protocol);
  if (extra.port) args.push("=dst-port=" + extra.port);
  try {
    await conn.talk(args);
    return true;
  } catch (e) {
    console.log("  ip skip", a, "—", (e.message || "").split(",")[0]);
    return false;
  }
}

console.log("=== GCash / PayMongo walled garden — router", ROUTER_ID, row.name, "===");
const portalIps = await resolveHostIps(PORTAL_HOST);
const portalIp = portalIps[0] || "187.77.145.131";
console.log("Portal:", PORTAL_HOST, "→", portalIp);

const conn = connFor(row);
await conn.ensureConnected();
console.log("Connected:", (await conn.identity()).name);

const removed = await maybeRefresh(conn);
if (REFRESH) console.log("Removed static JM rules:", removed);

const haveHosts = new Set();
const haveIps = new Set();
let addedHosts = 0;
let addedIps = 0;

const hosts = new Set([PORTAL_HOST, "www." + PORTAL_HOST, ...PAYMENT_HOSTS, ...CAPTIVE_HOSTS]);
for (const h of hosts) {
  if (await addHost(conn, h, "GCash PayMongo", haveHosts)) {
    addedHosts++;
    if (addedHosts <= 8 || addedHosts % 20 === 0) console.log("  + host", h);
  }
}

const ips = new Set(portalIps);
ips.add(portalIp);
ips.add("187.77.145.131");
for (const h of RESOLVE_HOSTS) {
  for (const ip of await resolveHostIps(h)) ips.add(ip);
}
for (const ip of ips) {
  if (await addIp(conn, ip, "GCash PayMongo ip", haveIps)) addedIps++;
}
for (const dnsIp of ["8.8.8.8", "8.8.4.4", "1.1.1.1"]) {
  if (await addIp(conn, dnsIp, "DNS", haveIps, { protocol: "udp", port: "53" })) addedIps++;
}

const total = (await conn.print("/ip/hotspot/walled-garden")).length;
const totalIp = (await conn.print("/ip/hotspot/walled-garden/ip")).length;
console.log("\nAdded", addedHosts, "hosts,", addedIps, "IPs");
console.log("Total walled-garden:", total, "hosts,", totalIp, "IPs");

conn.close?.();
console.log("\nDone — jmwifi.pro + GCash app open kahit walang WiFi login.");
