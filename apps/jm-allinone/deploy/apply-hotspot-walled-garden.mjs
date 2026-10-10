/**
 * Apply hotspot walled-garden (jmwifi.pro + GCash + PayMongo) on MikroTik router(s).
 * Usage (VPS): node deploy/apply-hotspot-walled-garden.mjs 4RTHSERVER 3RDSERVER
 */
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import path from "node:path";
import dns from "node:dns/promises";
import { RouterOSAPI } from "../lib/routeros-api.js";
import { PAYMENT_HOSTS, CAPTIVE_HOSTS } from "../lib/payment-whitelist-hosts.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DB = process.env.BILLING_DB || path.join(ROOT, "billing.db");
const JM = "JM ";
const PORTAL_HOST = "jmwifi.pro";
const RESOLVE_IP_HOSTS = [
  PORTAL_HOST,
  "www.jmwifi.pro",
  "gcash.com",
  "api.gcash.com",
  "api.m.gcash.com",
  "payments.gcash.com",
  "api.mynt.xyz",
  "paymongo.com",
  "api.paymongo.com",
  "checkout.paymongo.com",
  "pm.link",
];

const names = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (!names.length) {
  console.error("Usage: node deploy/apply-hotspot-walled-garden.mjs <router-name> [router-name...]");
  process.exit(1);
}

function getSetting(db, k, fallback = "") {
  const r = db.prepare("SELECT v FROM settings WHERE k=?").get(k);
  return (r && r.v != null ? String(r.v) : fallback).trim();
}

function findRouter(db, name) {
  let r = db.prepare("SELECT * FROM routers WHERE name=?").get(name);
  if (r) return r;
  r = db.prepare("SELECT * FROM routers WHERE UPPER(name)=UPPER(?)").get(name);
  if (r) return r;
  r = db.prepare("SELECT * FROM routers WHERE name LIKE ?").get(`%${name}%`);
  return r || null;
}

async function resolveHostIps(host) {
  const ips = new Set();
  try {
    for (const ip of await dns.resolve4(host)) ips.add(ip);
  } catch {}
  return [...ips];
}

async function resolvePortalIps(db) {
  const pub = getSetting(db, "public_url", "https://jmwifi.pro").replace(/^https?:\/\//, "").split("/")[0];
  const host = pub || PORTAL_HOST;
  const ips = new Set();
  for (const h of [host, PORTAL_HOST, "www." + PORTAL_HOST]) {
    for (const ip of await resolveHostIps(h)) ips.add(ip);
  }
  if (!ips.size) ips.add("187.77.145.131");
  return { host, ips: [...ips] };
}

function connForRow(row) {
  return new RouterOSAPI({
    host: String(row.host).split(":")[0],
    user: row.username || "",
    password: row.password || "",
    port: Number(row.port) || (row.ssl ? 8729 : 8728),
    ssl: !!row.ssl,
    timeout: 25000,
  });
}

async function removeJmWalledGarden(conn) {
  const rows = await conn.hotspotWalledGarden();
  let n = 0;
  for (const r of rows || []) {
    const c = String(r.comment || "");
    if (c.startsWith(JM)) {
      await conn.removeById("/ip/hotspot/walled-garden", r[".id"]);
      n++;
    }
  }
  return n;
}

async function ensureWalledGardenHost(conn, host, comment, have) {
  const h = String(host || "").trim().toLowerCase();
  if (!h || have.has("h:" + h)) return "skip";
  try {
    await conn.add("/ip/hotspot/walled-garden", { "dst-host": h, comment: JM + comment });
    have.add("h:" + h);
    return "add";
  } catch (e) {
    if (/already have/i.test(String(e.message || ""))) {
      have.add("h:" + h);
      return "exists";
    }
    throw e;
  }
}

async function ensureWalledGardenIp(conn, ip, comment, have) {
  const a = String(ip || "").trim();
  if (!a || have.has("a:" + a)) return "skip";
  try {
    await conn.add("/ip/hotspot/walled-garden/ip", { "dst-address": a, comment: JM + comment });
    have.add("a:" + a);
    return "add";
  } catch (e) {
    if (/already have/i.test(String(e.message || ""))) {
      have.add("a:" + a);
      return "exists";
    }
    throw e;
  }
}

async function applyToRouter(db, row) {
  const conn = connForRow(row);
  const { host: portalHost, ips: portalIps } = await resolvePortalIps(db);
  console.log("\n===", row.name, "@", row.host, "===");
  const ident = await conn.identity();
  console.log("Identity:", ident.name || ident);

  const removed = await removeJmWalledGarden(conn);
  console.log("Removed old JM walled-garden entries:", removed);

  const have = new Set();
  let added = 0;
  let skipped = 0;

  const hosts = new Set([portalHost, PORTAL_HOST, "www.jmwifi.pro"]);
  for (const h of CAPTIVE_HOSTS) hosts.add(h);
  for (const h of PAYMENT_HOSTS) hosts.add(h);

  for (const h of hosts) {
    const st = await ensureWalledGardenHost(conn, h, h.includes("gcash") || h.includes("mynt") ? "GCash/payment" : "online payment", have);
    if (st === "add") added++;
    else skipped++;
  }

  for (const ip of portalIps) {
    const st = await ensureWalledGardenIp(conn, ip, "portal IP " + ip, have);
    if (st === "add") added++;
    else skipped++;
  }

  for (const h of RESOLVE_IP_HOSTS) {
    for (const ip of await resolveHostIps(h)) {
      const st = await ensureWalledGardenIp(conn, ip, "ip " + h, have);
      if (st === "add") added++;
      else skipped++;
    }
  }

  const total = (await conn.hotspotWalledGarden()).length;
  console.log("Added:", added, "| Skipped/exists:", skipped, "| Total walled-garden rows now:", total);
  console.log("Voucher URL: https://" + (portalHost || PORTAL_HOST) + "/voucher");
  return { name: row.name, added, total, ok: true };
}

async function main() {
  const db = new DatabaseSync(DB);
  const results = [];
  for (const name of names) {
    const row = findRouter(db, name);
    if (!row) {
      console.error("Router not found in billing DB:", name);
      results.push({ name, ok: false, error: "not found" });
      continue;
    }
    if (!row.password) {
      console.error("No API password for router:", row.name);
      results.push({ name: row.name, ok: false, error: "no password" });
      continue;
    }
    try {
      results.push(await applyToRouter(db, row));
    } catch (e) {
      console.error("FAILED", row.name + ":", e.message);
      results.push({ name: row.name, ok: false, error: e.message });
    }
  }
  console.log("\nSummary:", JSON.stringify(results, null, 2));
  if (results.some((r) => !r.ok)) process.exit(1);
}

main();
