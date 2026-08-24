/**
 * Set PANISIJAN (router 51) hotspot portal/network to 10.0.0.1/24.
 * Usage: BILLING_DB=/opt/jm-billing/billing.db node deploy/set-panisijan-hs-ip.mjs
 */
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { RouterOSAPI } from "../lib/routeros-api.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DB = process.env.BILLING_DB || path.join(ROOT, "billing.db");
const ROUTER_ID = 51;
const HS_GW = "10.0.0.1";
const HS_NET = "10.0.0.0/24";
const POOL = "10.0.0.2-10.0.0.254";
const IFACE = "bridge-HS";

const db = new DatabaseSync(DB);
const row = db.prepare("SELECT * FROM routers WHERE id=?").get(ROUTER_ID);
if (!row) throw new Error("Router " + ROUTER_ID + " not found");

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

function upsertSetting(k, v) {
  db.prepare("INSERT INTO settings (k,v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").run(k, String(v));
}

console.log("=== PANISIJAN hotspot →", HS_GW, "===");

const conn = connFor(row);
await conn.ensureConnected();
console.log("Connected:", row.name);

const hs = await conn.print("/ip/hotspot");
for (const h of hs) {
  await conn.talk(["/ip/hotspot/disable", "=.id=" + h[".id"]]);
  console.log("disabled hotspot", h.name);
}

const pool = (await conn.print("/ip/pool")).find((p) => p.name === "dhcp_pool0");
if (pool) {
  await conn.talk(["/ip/pool/set", "=.id=" + pool[".id"], "=ranges=" + POOL]);
  console.log("pool dhcp_pool0 ->", POOL);
}

const net = (await conn.print("/ip/dhcp-server/network")).find((n) => n.address?.startsWith("172.30.30") || n.address?.startsWith("10.0.0"));
if (net) {
  await conn.talk([
    "/ip/dhcp-server/network/set",
    "=.id=" + net[".id"],
    "=address=" + HS_NET,
    "=gateway=" + HS_GW,
  ]);
  console.log("dhcp network ->", HS_NET, "gw", HS_GW);
}

const addrs = await conn.print("/ip/address");
for (const a of addrs) {
  if (a.interface !== IFACE) continue;
  if (a.address === HS_GW + "/24") continue;
  await conn.talk(["/ip/address/remove", "=.id=" + a[".id"]]);
  console.log("removed old IP", a.address, "on", IFACE);
}
const hasGw = addrs.some((a) => a.interface === IFACE && a.address === HS_GW + "/24");
if (!hasGw) {
  await conn.talk(["/ip/address/add", "=address=" + HS_GW + "/24", "=interface=" + IFACE, "=network=10.0.0.0"]);
  console.log("added", HS_GW + "/24 on", IFACE);
}

const prof = await conn.print("/ip/hotspot/profile");
for (const p of prof) {
  if (p["hotspot-address"] === HS_GW) continue;
  await conn.talk(["/ip/hotspot/profile/set", "=.id=" + p[".id"], "=hotspot-address=" + HS_GW]);
  console.log("profile", p.name, "hotspot-address ->", HS_GW);
}

for (const h of hs) {
  await conn.talk(["/ip/hotspot/enable", "=.id=" + h[".id"]]);
  console.log("enabled hotspot", h.name);
}

upsertSetting("kitifi_hotspot_login_" + ROUTER_ID, "http://" + HS_GW + "/login");
console.log("billing kitifi_hotspot_login_51 -> http://" + HS_GW + "/login");

conn.close?.();

const verify = connFor(row);
await verify.ensureConnected();
const vAddr = await verify.print("/ip/address");
const vProf = await verify.print("/ip/hotspot/profile");
console.log("\nVerify IP:", vAddr.filter((a) => a.interface === IFACE).map((a) => a.address));
console.log("Verify profile:", vProf.map((p) => p.name + "=" + p["hotspot-address"]));
verify.close?.();
console.log("\nDone.");
