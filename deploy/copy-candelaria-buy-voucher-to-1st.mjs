/**
 * Copy Candelaria-kitifi BUY VOUCHER (GCash) setup → 1STSERVER (router 52).
 *
 * Candelaria (34) is read-only. Panisijan is not touched. Free-register stays off.
 *
 * Copies:
 * - ₱20 / 10 Hours and ₱30 / 15 Hours rates on the VOUCHER seller
 * - GCash / PayMongo / jmwifi.pro walled garden
 * - BUY VOUCHER portal HTML (Register / Claim Free stay removed)
 * - billing kitifi_plans_52 + kitifi_seller_id_52 + hotspot login
 *
 * Usage on VPS:
 *   cd /opt/jm-billing && node deploy/copy-candelaria-buy-voucher-to-1st.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

export const CANDELARIA_ROUTER_ID = 34;
export const FIRST_SERVER_ROUTER_ID = 52;
export const SELLER_NAME = "VOUCHER";
export const HS_ADDRESS = "10.0.0.1";
export const GCASH_RATE_DEFS = [
  { amount: "20", time: "36000", expiry: "86400" },
  { amount: "30", time: "54000", expiry: "86400" },
];
export const REQUIRED_WALLED_HOSTS = [
  "jmwifi.pro",
  "www.jmwifi.pro",
  "gcash.com",
  "www.gcash.com",
  "m.gcash.com",
  "paymongo.com",
  "checkout.paymongo.com",
];

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DB = process.env.BILLING_DB || process.env.DB_FILE || path.join(ROOT, "billing.db");
const HTML_REL = "public/kitifi/status-portal-5th.html";
const CSS_REL = "public/kitifi/status-portal.css";
const SKIP_REMOTE = process.env.SKIP_REMOTE === "1";

export function stripHtml(s) {
  return String(s || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

export function rateAmountNum(r) {
  const raw = String(r?.amount || r?.price || "");
  const head = raw.includes("|") ? raw.split("|")[0] : raw;
  return Number(head.replace(/[^\d.]/g, "")) || Number(r?.price) || 0;
}

export function gcashRatesOnly(rates) {
  return (rates || []).filter((r) => rateAmountNum(r) >= 20);
}

export function buildGcashPlans(gcash, profile = "KITIFI") {
  return gcashRatesOnly(gcash).map((r) => {
    const amount = rateAmountNum(r);
    const time = stripHtml(r.time) || (amount === 20 ? "10 Hours" : "15 Hours");
    const id = String(r.id ?? r.kitifi_rate_id ?? "");
    return {
      id: "r" + id,
      name: time,
      price: amount,
      uptime: time,
      time,
      expiry: "N/A",
      pause_limit: "0",
      label: `₱ ${amount} | ${time} | N/A | 0`,
      amount_display: "₱ " + amount,
      profile,
      kitifi_rate_id: id,
      r_id: id,
      speed: "4Mbps",
    };
  });
}

export function assertBuyVoucherPortalHtml(html) {
  const text = String(html || "");
  if (!/id=["']gcashBuyBtn["']/i.test(text) || !/BUY VOUCHER/i.test(text)) {
    throw new Error("Portal HTML is missing BUY VOUCHER");
  }
  if (/id=["']freeWifiBtn["']/i.test(text) || /Create account to get free internet/i.test(text)) {
    throw new Error("Portal HTML still has Register / freeWifiBtn");
  }
  return true;
}

export function missingWalledHosts(have, required = REQUIRED_WALLED_HOSTS) {
  const set = new Set((have || []).map((h) => String(h).toLowerCase()));
  return required.filter((h) => !set.has(String(h).toLowerCase()));
}

function jsonFrom(text) {
  const i = String(text || "").indexOf("{");
  if (i < 0) return null;
  try {
    return JSON.parse(text.slice(i));
  } catch {
    return null;
  }
}

function routerConn(db, id) {
  const row = db.prepare("SELECT * FROM routers WHERE id=?").get(id);
  if (!row?.host) throw new Error("Router " + id + " not found");
  return row;
}

async function mikrotik(row) {
  const { RouterOSAPI } = await import("../lib/routeros-api.js");
  return new RouterOSAPI({
    host: String(row.host).split(":")[0],
    user: row.username,
    password: row.password,
    port: Number(row.port) || 8728,
    ssl: !!row.ssl,
    timeout: Number(process.env.KITIFI_TIMEOUT_MS || 120000),
  });
}

async function kitifiPost(conn, cookie, routerId, body) {
  const { kitifiAdminBase } = await import("../lib/kitifi-remote.js");
  const r = await conn.talk([
    "/tool/fetch",
    "=url=" + kitifiAdminBase(routerId) + "/api/pages/settings",
    "=mode=http",
    "=http-method=post",
    "=http-header-field=Cookie: " + cookie + "\r\nContent-Type: application/json",
    "=http-data=" + JSON.stringify(body),
    "=output=user-with-headers",
    "=check-certificate=no",
  ]);
  return (r || []).map((x) => x.data || "").join("");
}

async function homePost(conn, cookie, routerId, body) {
  const { kitifiAdminBase } = await import("../lib/kitifi-remote.js");
  const r = await conn.talk([
    "/tool/fetch",
    "=url=" + kitifiAdminBase(routerId) + "/api/pages/home.php",
    "=mode=http",
    "=http-method=post",
    "=http-header-field=Cookie: " + cookie + "\r\nContent-Type: application/json",
    "=http-data=" + JSON.stringify(body),
    "=output=user-with-headers",
    "=check-certificate=no",
  ]);
  return jsonFrom((r || []).map((x) => x.data || "").join("")) || {};
}

async function ensureGcashRates(conn, cookie, routerId, sellerApiId) {
  let gr = await homePost(conn, cookie, routerId, { id: sellerApiId, action: "getrates" });
  let gcash = gcashRatesOnly(gr.rates || []);
  if (gcash.length >= 2) return gcash;
  console.log("Adding GCash ₱20 / ₱30 rates on VOUCHER seller…");
  for (const def of GCASH_RATE_DEFS) {
    let res = await homePost(conn, cookie, routerId, {
      id: sellerApiId,
      action: "addrates",
      amount: def.amount,
      time: def.time,
      expiry: def.expiry,
      pause_limit: "0",
      points: "0",
    });
    if (res?.status === false && /expiry/i.test(String(res.message || ""))) {
      res = await homePost(conn, cookie, routerId, {
        id: sellerApiId,
        action: "addrates",
        amount: def.amount,
        time: def.time,
        expiry: "0",
        pause_limit: "0",
        points: "0",
      });
    }
    console.log(" addrates ₱" + def.amount, res?.status !== false ? "OK" : (res?.message || "fail"));
  }
  gr = await homePost(conn, cookie, routerId, { id: sellerApiId, action: "getrates" });
  return gcashRatesOnly(gr.rates || []);
}

async function syncWalledGarden(srcConn, dstConn, srcName) {
  const srcWg = await srcConn.print("/ip/hotspot/walled-garden");
  const srcWgi = await srcConn.print("/ip/hotspot/walled-garden/ip");
  const dstWg = await dstConn.print("/ip/hotspot/walled-garden");
  const dstWgi = await dstConn.print("/ip/hotspot/walled-garden/ip");
  let added = 0;
  for (const w of srcWg) {
    const host = String(w["dst-host"] || "");
    if (!host) continue;
    if (dstWg.find((d) => String(d["dst-host"] || "").toLowerCase() === host.toLowerCase())) continue;
    await dstConn.talk([
      "/ip/hotspot/walled-garden/add",
      "=dst-host=" + host,
      "=action=" + (w.action || "allow"),
      "=comment=" + (w.comment || "Copied from " + srcName),
    ]);
    added++;
  }
  for (const w of srcWgi) {
    const ip = String(w["dst-address"] || "");
    if (!ip || dstWgi.find((d) => d["dst-address"] === ip)) continue;
    await dstConn.talk([
      "/ip/hotspot/walled-garden/ip/add",
      "=dst-address=" + ip,
      "=action=" + (w.action || "accept"),
      "=comment=" + (w.comment || "Copied from " + srcName),
    ]);
    added++;
  }
  const after = await dstConn.print("/ip/hotspot/walled-garden");
  const missing = missingWalledHosts(after.map((w) => w["dst-host"]));
  if (missing.length) throw new Error("Walled garden still missing: " + missing.join(", "));
  console.log("[" + FIRST_SERVER_ROUTER_ID + "] walled garden entries added:", added);
  return added;
}

function saveBilling(db, { sellerApiId, plans, brand }) {
  const upsert = db.prepare(
    "INSERT INTO settings (k,v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v"
  );
  upsert.run("kitifi_seller_id_" + FIRST_SERVER_ROUTER_ID, String(sellerApiId));
  upsert.run("kitifi_plans_" + FIRST_SERVER_ROUTER_ID, JSON.stringify(plans));
  upsert.run("kitifi_hotspot_login_" + FIRST_SERVER_ROUTER_ID, "http://" + HS_ADDRESS + "/login");
  upsert.run("kitifi_seller_name", SELLER_NAME);
  let sites = {};
  try {
    const raw = db.prepare("SELECT v FROM settings WHERE k=?").get("kitifi_portal_sites")?.v;
    if (raw) sites = JSON.parse(raw);
  } catch {}
  if (sites["42"]) sites["42"].enabled = false;
  sites[String(FIRST_SERVER_ROUTER_ID)] = {
    name: "1STSERVER",
    label: "1STSERVER",
    brand: brand || "1ST SERVER",
    enabled: true,
    updated: new Date().toISOString(),
    copied_from: CANDELARIA_ROUTER_ID,
  };
  upsert.run("kitifi_portal_sites", JSON.stringify(sites));
}

async function main() {
  const htmlPath = path.join(ROOT, HTML_REL);
  if (!fs.existsSync(htmlPath)) throw new Error("Missing " + HTML_REL);
  const html = fs.readFileSync(htmlPath, "utf8");
  assertBuyVoucherPortalHtml(html);
  const css = fs.existsSync(path.join(ROOT, CSS_REL))
    ? fs.readFileSync(path.join(ROOT, CSS_REL), "utf8")
    : "";

  if (SKIP_REMOTE) {
    console.log("SKIP_REMOTE=1 — HTML check only");
    return;
  }
  if (!fs.existsSync(DB)) throw new Error("Missing billing DB: " + DB);

  const db = new DatabaseSync(DB);
  const srcRow = routerConn(db, CANDELARIA_ROUTER_ID);
  const dstRow = routerConn(db, FIRST_SERVER_ROUTER_ID);
  console.log("Source:", srcRow.name, "(" + CANDELARIA_ROUTER_ID + ") READ-ONLY");
  console.log("Target:", dstRow.name, "(" + FIRST_SERVER_ROUTER_ID + ")");

  const { kitifiLogin, kitifiDiscoverSellerApiId, kitifiAdminPass } = await import("../lib/kitifi-remote.js");
  const dstConn = await mikrotik(dstRow);
  await dstConn.identity();
  const cookie = await kitifiLogin(dstConn, FIRST_SERVER_ROUTER_ID);
  if (!kitifiAdminPass(FIRST_SERVER_ROUTER_ID)) {
    const fallback =
      db.prepare("SELECT v FROM settings WHERE k=?").get("kitifi_admin_pass")?.v ||
      db.prepare("SELECT v FROM settings WHERE k=?").get("kitifi_admin_pass_34")?.v ||
      "";
    if (fallback) {
      db.prepare(
        "INSERT INTO settings (k,v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v"
      ).run("kitifi_admin_pass_" + FIRST_SERVER_ROUTER_ID, fallback);
      console.log("copied KiTifi admin pass setting onto router 52");
    }
  }

  const curText = await kitifiPost(dstConn, cookie, FIRST_SERVER_ROUTER_ID, { page: "portalsettings" });
  const cur = jsonFrom(curText)?.data || {};
  const save = await kitifiPost(dstConn, cookie, FIRST_SERVER_ROUTER_ID, {
    ...cur,
    brand: cur.brand || dstRow.name,
    hs_address: HS_ADDRESS,
    pauseBtn: cur.pauseBtn ?? 1,
    insertBtn: cur.insertBtn ?? 1,
    ratesBtn: 0,
    voucherInput: 1,
    freetimeBtn: 0,
    action: "savePortalSettings",
  });
  console.log("savePortalSettings:", save.slice(0, 120));

  const htmlRes = await kitifiPost(dstConn, cookie, FIRST_SERVER_ROUTER_ID, {
    action: "savehtmlportal",
    html_portal: html,
  });
  console.log("savehtmlportal:", htmlRes.slice(0, 120));
  if (!/"status"\s*:\s*true/i.test(htmlRes)) throw new Error("savehtmlportal failed");
  if (css) {
    const cssRes = await kitifiPost(dstConn, cookie, FIRST_SERVER_ROUTER_ID, {
      action: "savecssportal",
      css_portal: css,
    });
    console.log("savecssportal:", cssRes.slice(0, 120));
  }

  const sellerApiId = await kitifiDiscoverSellerApiId(dstConn, cookie, {
    name: SELLER_NAME,
    routerId: FIRST_SERVER_ROUTER_ID,
  });
  console.log("VOUCHER seller API id:", sellerApiId);
  const gcash = await ensureGcashRates(dstConn, cookie, FIRST_SERVER_ROUTER_ID, sellerApiId);
  if (gcash.length < 2) throw new Error("1STSERVER still missing ₱20/₱30 GCash rates");
  for (const r of gcash) console.log(" ", r.id, stripHtml(r.amount) || r.amount, "|", stripHtml(r.time));
  const plans = buildGcashPlans(gcash);
  saveBilling(db, { sellerApiId, plans, brand: cur.brand || dstRow.name });
  console.log("billing kitifi_plans_52:", plans.map((p) => p.label).join(" ; "));

  console.log("\n--- Walled garden from Candelaria ---");
  const srcConn = await mikrotik(srcRow);
  await srcConn.identity();
  await syncWalledGarden(srcConn, dstConn, srcRow.name);
  srcConn.close?.();
  dstConn.close?.();
  console.log("\nDone. 1STSERVER BUY VOUCHER now matches Candelaria (₱20/10h + ₱30/15h). Register stays off.");
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  main().catch((e) => {
    console.error("FAILED:", e.message);
    process.exit(1);
  });
}
