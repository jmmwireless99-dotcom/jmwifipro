/**
 * PANISIJAN (router 51) free WiFi captive portal + jmwifi.pro registration flow.
 * Usage: BILLING_DB=/opt/jm-billing/billing.db node deploy/setup-panisijan-free-wifi.mjs
 */
import fs from "node:fs";
import path from "node:path";
import dns from "node:dns/promises";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { RouterOSAPI } from "../lib/routeros-api.js";
import { applyPaymentWalledGarden } from "../lib/payment-whitelist-hosts.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DB = process.env.BILLING_DB || path.join(ROOT, "billing.db");
const ROUTER_ID = 51;
const HS_GW = "10.0.0.1";
const PORTAL_HOST = "jmwifi.pro";
const LOGIN_FILE = "flash/hotspot/login.html";

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

async function resolveHostIps(host) {
  const ips = new Set();
  try {
    for (const ip of await dns.resolve4(host)) ips.add(ip);
  } catch {}
  return [...ips];
}

async function setFile(c, name, contents) {
  const files = await c.print("/file");
  const f = files.find((x) => x.name === name);
  if (f) {
    await c.talk(["/file/set", "=.id=" + f[".id"], "=contents=" + contents]);
    return "set";
  }
  await c.talk(["/file/add", "=name=" + name, "=contents=" + contents]);
  return "add";
}

async function ensureWalledGarden(conn, portalIps) {
  const portalIp = portalIps[0] || "187.77.145.131";
  const result = await applyPaymentWalledGarden(conn, {
    portalHost: PORTAL_HOST,
    portalIp,
    resolveHostIps,
    commentTag: "GCash PayMongo",
  });
  console.log("  payment walled-garden: +" + result.addedHosts + " hosts, +" + result.addedIps + " IPs");
}

async function ensureFreeProfile(conn) {
  const profiles = await conn.print("/ip/hotspot/user/profile");
  let free = profiles.find((p) => p.name === "FREE");
  if (!free) {
    await conn.talk([
      "/ip/hotspot/user/profile/add",
      "=name=FREE",
      "=shared-users=1",
      "=add-mac-cookie=yes",
      "=mac-cookie-timeout=3d",
    ]);
    console.log("  created hotspot user profile FREE");
  } else {
    console.log("  hotspot user profile FREE exists");
  }
}

async function fixHotspotAddress(conn) {
  const prof = await conn.print("/ip/hotspot/profile");
  for (const p of prof) {
    if (p["hotspot-address"] === HS_GW) continue;
    await conn.talk(["/ip/hotspot/profile/set", "=.id=" + p[".id"], "=hotspot-address=" + HS_GW]);
    console.log("  profile", p.name, "hotspot-address ->", HS_GW);
  }
}

async function restartHotspot(conn) {
  const hs = await conn.print("/ip/hotspot");
  for (const h of hs) {
    await conn.talk(["/ip/hotspot/disable", "=.id=" + h[".id"]]);
    await conn.talk(["/ip/hotspot/enable", "=.id=" + h[".id"]]);
    console.log("  restarted hotspot", h.name);
  }
}

async function ensureBanner(conn) {
  const files = await conn.print("/file");
  const hasBanner = files.some((f) => f.name === "flash/hotspot/img/banner.png");
  if (hasBanner) {
    console.log("  banner.png already on router");
    return;
  }
  const bannerLocal = path.join(ROOT, "public", "hotspot", "img", "panisijan-banner.png");
  const bannerUrl = "https://jmwifi.pro/hotspot/img/panisijan-banner.png";
  if (fs.existsSync(bannerLocal)) {
    try {
      await conn.talk([
        "/tool/fetch",
        "=url=" + bannerUrl,
        "=dst-path=flash/hotspot/img/banner.png",
        "=mode=https",
        "=check-certificate=no",
      ]);
      console.log("  fetched banner.png from jmwifi.pro");
      return;
    } catch (e) {
      console.log("  fetch banner warn:", e.message);
    }
  }
  const logo = files.find((f) => f.name === "flash/hotspot/img/logo.png");
  if (logo) {
    try {
      await conn.talk([
        "/file/copy",
        "=source=flash/hotspot/img/logo.png",
        "=destination=flash/hotspot/img/banner.png",
      ]);
      console.log("  copied logo.png -> banner.png");
    } catch (e) {
      console.log("  banner copy warn:", e.message);
    }
  }
}

console.log("=== PANISIJAN free WiFi setup (router", ROUTER_ID + ") ===");

const loginPath = path.join(ROOT, "public", "hotspot", "panisijan-login.html");
const loginHtml = fs.readFileSync(loginPath, "utf8");

const settings = {
  kitifi_free_enabled: "1",
  kitifi_free_hours: "5",
  kitifi_free_limit_per_day_51: "1",
  kitifi_free_default_barangay_51: "Panisijan",
  kitifi_free_default_municipal_51: "Uson",
  kitifi_free_default_province_51: "Masbate",
  kitifi_free_mode_51: "mikrotik",
  kitifi_free_profile_51: "FREE",
  kitifi_free_rate_time_51: "5 Hours",
  kitifi_hotspot_login_51: "http://" + HS_GW + "/login",
  kitifi_free_mikrotik_routers: "51",
  kitifi_gen_profile_51: "default",
  kitifi_default_profile_51: "default",
};
for (const [k, v] of Object.entries(settings)) upsertSetting(k, v);

const plansKey = "kitifi_plans_" + ROUTER_ID;
const plansRow = db.prepare("SELECT v FROM settings WHERE k=?").get(plansKey);
if (plansRow?.v) {
  try {
    const plans = JSON.parse(plansRow.v);
    if (Array.isArray(plans)) {
      let n = 0;
      for (const p of plans) {
        if (String(p.profile || "").toUpperCase() === "KITIFI" || !p.profile) {
          p.profile = "default";
          n++;
        }
      }
      if (n) {
        upsertSetting(plansKey, JSON.stringify(plans));
        console.log("  fixed", n, "GCash plan profile(s) KITIFI → default");
      }
    }
  } catch {}
}

console.log("Billing settings updated for PANISIJAN");

const portalIps = await resolveHostIps(PORTAL_HOST);
if (!portalIps.length) portalIps.push("187.77.145.131");
console.log("Portal IPs:", portalIps.join(", "));

const conn = connFor(row);
await conn.ensureConnected();
console.log("Connected:", row.name, "—", (await conn.identity()).name);

console.log("\n=== Hotspot profile address ===");
await fixHotspotAddress(conn);

console.log("\n=== Hotspot user profile ===");
await ensureFreeProfile(conn);

console.log("\n=== Walled garden ===");
await ensureWalledGarden(conn, portalIps);

console.log("\n=== Banner image ===");
await ensureBanner(conn);

console.log("\n=== Upload login page ===");
const action = await setFile(conn, LOGIN_FILE, loginHtml);
console.log(" ", action, LOGIN_FILE, "(" + loginHtml.length + " bytes)");

console.log("\n=== Restart hotspot ===");
await restartHotspot(conn);

conn.close?.();
console.log("\nDone.");
console.log("Flow: connect SSID -> REGISTER (free) or Buy Voucher GCash (QR + auto-connect) -> jmwifi.pro");
