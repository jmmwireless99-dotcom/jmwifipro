/** Read-only check of suspend firewall on MikroTik. */
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { RouterOSAPI } from "../lib/routeros-api.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DB = process.env.BILLING_DB || "/opt/jm-billing/billing.db";
const ROUTER_NAME = process.argv[2] || "PPPOE-MAIN";

function getSetting(db, k, fallback = "") {
  const r = db.prepare("SELECT v FROM settings WHERE k=?").get(k);
  return (r && r.v != null ? String(r.v) : fallback).trim();
}

function legacyRouter(db) {
  const host = getSetting(db, "mikrotik_host");
  if (!host) return null;
  let password = getSetting(db, "mikrotik_password");
  if (password === "***") password = process.env.MIKROTIK_PASSWORD || "";
  return {
    host: host.split(":")[0],
    port: Number(getSetting(db, "mikrotik_port", "8728")) || 8728,
    username: getSetting(db, "mikrotik_user"),
    password,
    ssl: getSetting(db, "mikrotik_ssl") === "1" ? 1 : 0,
  };
}

function findRouter(db, name) {
  return db.prepare("SELECT * FROM routers WHERE name=? OR name LIKE ? LIMIT 1").get(name, `%${name}%`)
    || db.prepare("SELECT * FROM routers WHERE is_default=1 LIMIT 1").get()
    || legacyRouter(db);
}

async function main() {
  const db = new DatabaseSync(DB);
  const row = findRouter(db, ROUTER_NAME);
  if (!row?.host) throw new Error("No router");
  const conn = new RouterOSAPI({
    host: String(row.host).split(":")[0],
    user: row.username || "",
    password: row.password || "",
    port: Number(row.port) || 8728,
    ssl: !!row.ssl,
    timeout: 20000,
  });
  const ident = await conn.identity();
  console.log("Identity:", ident.name || ident);
  const prof = (await conn.pppProfiles()).find((p) => p.name === "suspended-pool");
  console.log("Profile suspended-pool:", prof ? {
    "address-list": prof["address-list"],
    "rate-limit": prof["rate-limit"],
    pool: prof["remote-address"],
  } : "MISSING");
  const wl = await conn.print("/ip/firewall/address-list", { list: "payment-whitelist" });
  console.log("\npayment-whitelist (" + (wl?.length || 0) + "):");
  for (const r of (wl || []).slice(0, 30)) console.log(" ", r.address, r.comment || "");
  if ((wl?.length || 0) > 30) console.log("  ... +" + ((wl?.length || 0) - 30));
  const sus = await conn.print("/ip/firewall/address-list", { list: "suspended" });
  console.log("\nsuspended list:", sus?.length || 0, "entries");
  const rules = (await conn.print("/ip/firewall/filter")).filter((r) => String(r.comment || "").startsWith("JM suspend:"));
  console.log("\nJM suspend rules (" + rules.length + "):");
  for (const r of rules) {
    console.log(" ", r.action, r.protocol || "*", r["dst-port"] || "", r["tls-host"] || r["dst-address-list"] || r["dst-address"] || r["out-interface"] || "", "-", r.comment);
  }
  try { conn.close && conn.close(); } catch {}
}

main().catch((e) => { console.error(e.message); process.exit(1); });
