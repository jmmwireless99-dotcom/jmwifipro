/**
 * PANISIJAN router 51 — walled garden for GCash / PayMongo / jmwifi.pro (no load needed).
 * Usage: BILLING_DB=/opt/jm-billing/billing.db node deploy/apply-panisijan-gcash-walled-garden.mjs
 */
import dns from "node:dns/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { RouterOSAPI } from "../lib/routeros-api.js";
import { applyPaymentWalledGarden, hotspotWalledGardenCommands } from "../lib/payment-whitelist-hosts.js";

const ROUTER_ID = Number(process.env.ROUTER_ID || 51);
const PORTAL_HOST = process.env.PORTAL_HOST || "jmwifi.pro";
const DB = process.env.BILLING_DB || path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "billing.db");

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

const conn = new RouterOSAPI({
  host: String(row.host).split(":")[0],
  user: row.username,
  password: row.password,
  port: Number(row.port) || 8728,
  ssl: !!row.ssl,
  timeout: 90000,
});

console.log("=== GCash / PayMongo walled garden — router", ROUTER_ID, "===");
const portalIps = await resolveHostIps(PORTAL_HOST);
const portalIp = portalIps[0] || "187.77.145.131";
console.log("Portal:", PORTAL_HOST, "→", portalIp);

await conn.ensureConnected();
console.log("Connected:", row.name);

const result = await applyPaymentWalledGarden(conn, {
  portalHost: PORTAL_HOST,
  portalIp,
  resolveHostIps,
  commentTag: "GCash PayMongo",
});

console.log("Added", result.addedHosts, "host rules,", result.addedIps, "IP rules");
console.log("\n--- RouterOS script (for manual paste) ---");
console.log(hotspotWalledGardenCommands({ portalHost: PORTAL_HOST, portalIp }));

conn.close?.();
console.log("\nDone. Clients can open jmwifi.pro + GCash app before WiFi login.");
