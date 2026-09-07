/**
 * Disable Register / Claim Free on every KiTifi server.
 * Panisijan (router 51) is the only site that keeps free-internet registration.
 *
 * - Global kitifi_free_enabled=0, per-router 0 for all KiTifi ids, 51 stays 1.
 * - register() rejects when the site is disabled (Panisijan stays enabled).
 * - free-internet.html hides the Register form when enabled=false.
 * - Pushes public/kitifi/status-portal-5th.html (no Register / Claim Free;
 *   BUY VOUCHER + Insert Coin stay) to every KiTifi controller except Panisijan.
 * - Does not edit public/hotspot/panisijan-login.html.
 *
 * Usage on VPS:
 *   cd /opt/jm-billing && node deploy/disable-5th-register-claim-free.mjs
 *   systemctl restart jm-billing
 *
 * If MikroTik VPN is down, the DB flags still apply immediately. Re-run
 * this script later to push the portal HTML.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

export const PANISIJAN_ROUTER_ID = 51;
export const FIFTH_SERVER_ROUTER_ID = 45;
export const FIFTH_SERVER_NAME = "5thserver";
export const FREE_ENABLED_KEY = "kitifi_free_enabled_" + FIFTH_SERVER_ROUTER_ID;
export const PANISIJAN_FREE_ENABLED_KEY = "kitifi_free_enabled_" + PANISIJAN_ROUTER_ID;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DB = process.env.BILLING_DB || process.env.DB_FILE || path.join(ROOT, "billing.db");
const HTML_REL = "public/kitifi/status-portal-5th.html";
const SKIP_PORTAL = process.env.SKIP_PORTAL_PUSH === "1";

export function isPanisijanRouter(id, name = "") {
  return Number(id) === PANISIJAN_ROUTER_ID || /panisijan/i.test(String(name || ""));
}

export function isKitifiTargetRouter(row) {
  const id = Number(row?.id);
  const name = String(row?.name || "");
  if (!id || isPanisijanRouter(id, name)) return false;
  if (/pppoe/i.test(name)) return false;
  return /kitifi|server|cagbatang|cawayan/i.test(name);
}

export function extraKitifiIdsFromPortalSites(json) {
  try {
    return Object.keys(JSON.parse(json || "{}"))
      .map(Number)
      .filter((id) => id && id !== PANISIJAN_ROUTER_ID);
  } catch {
    return [];
  }
}

export function collectKitifiIds(db) {
  const ids = new Set();
  for (const r of db.prepare("SELECT id,name FROM routers").all()) {
    if (isKitifiTargetRouter(r)) ids.add(Number(r.id));
  }
  const sites = db.prepare("SELECT v FROM settings WHERE k=?").get("kitifi_portal_sites");
  for (const id of extraKitifiIdsFromPortalSites(sites?.v)) ids.add(id);
  const keys = db
    .prepare(
      "SELECT k FROM settings WHERE k LIKE 'kitifi_plans_%' OR k LIKE 'kitifi_hotspot_login_%'"
    )
    .all();
  for (const { k } of keys) {
    const id = Number(String(k).split("_").pop());
    if (id && id !== PANISIJAN_ROUTER_ID) ids.add(id);
  }
  return [...ids].sort((a, b) => a - b);
}

export function stripRegisterClaimFree(html) {
  let out = String(html || "");
  out = out.replace(
    /<button\b[^>]*\bid=["']freeWifiBtn["'][^>]*>[\s\S]*?<\/button>\s*/gi,
    ""
  );
  out = out.replace(
    /\{%\s*if\s+freetimeBtn\s*==\s*1\s*%\}[\s\S]*?\{%\s*endif\s*%\}/g,
    ""
  );
  out = out.replace(
    /<button\b[^>]*\bid=["']freetimeBtn["'][^>]*>[\s\S]*?<\/button>\s*/gi,
    ""
  );
  return out;
}

export function assertFifthPortalHtml(html) {
  const text = String(html || "");
  if (/id=["']freeWifiBtn["']/i.test(text)) {
    throw new Error("KiTifi portal HTML still has Register / freeWifiBtn");
  }
  if (/Create account to get free internet/i.test(text)) {
    throw new Error("KiTifi portal HTML still has Register copy");
  }
  if (/Claim Free Time/i.test(text)) {
    throw new Error("KiTifi portal HTML still has Claim Free Time");
  }
  if (!/id=["']gcashBuyBtn["']/i.test(text) || !/BUY VOUCHER/i.test(text)) {
    throw new Error("KiTifi portal HTML is missing BUY VOUCHER");
  }
  return true;
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

export function disableFreeSettings(dbPath) {
  if (!fs.existsSync(dbPath)) {
    console.log("DB not found (ok if copying files only):", dbPath);
    return [];
  }
  const db = new DatabaseSync(dbPath);
  const upsert = db.prepare(
    "INSERT INTO settings (k,v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v"
  );
  const ids = collectKitifiIds(db);
  upsert.run("kitifi_free_enabled", "0");
  upsert.run(PANISIJAN_FREE_ENABLED_KEY, "1");
  for (const id of ids) {
    if (id === PANISIJAN_ROUTER_ID) continue;
    upsert.run("kitifi_free_enabled_" + id, "0");
  }
  const rows = db
    .prepare("SELECT k,v FROM settings WHERE k LIKE 'kitifi_free_enabled%' ORDER BY k")
    .all();
  for (const row of rows) console.log(row.k + "=" + row.v);
  return ids;
}

const REGISTER_ORIGINAL =
  "const rid = Number(routerId) || kitifiPortalRouterId();\n      const existing = byMac(m, rid);";
const REGISTER_FIFTH_ONLY =
  "const rid = Number(routerId) || kitifiPortalRouterId();\n" +
  "      if (rid === " +
  FIFTH_SERVER_ROUTER_ID +
  " && !kitifiFreeSettings(rid).enabled) throw new Error(\"Free internet is disabled.\");\n" +
  "      const existing = byMac(m, rid);";
const REGISTER_GLOBAL =
  "const rid = Number(routerId) || kitifiPortalRouterId();\n" +
  "      if (!kitifiFreeSettings(rid).enabled) throw new Error(\"Free internet is disabled.\");\n" +
  "      const existing = byMac(m, rid);";

export function patchRegisterRejectsDisabled(src) {
  let out = String(src || "");
  if (out.includes(REGISTER_GLOBAL)) return { src: out, changed: false };
  if (out.includes(REGISTER_FIFTH_ONLY)) {
    return { src: out.split(REGISTER_FIFTH_ONLY).join(REGISTER_GLOBAL), changed: true };
  }
  if (!out.includes(REGISTER_ORIGINAL)) {
    return { src: out, changed: false, missing: true };
  }
  return { src: out.split(REGISTER_ORIGINAL).join(REGISTER_GLOBAL), changed: true };
}

function patchLiveRegisterGate() {
  const p = path.join(ROOT, "lib/kitifi-free-wifi.js");
  if (!fs.existsSync(p)) {
    console.log("lib/kitifi-free-wifi.js not in this tree (ok on git-only checkout)");
    return;
  }
  const cur = fs.readFileSync(p, "utf8");
  const next = patchRegisterRejectsDisabled(cur);
  if (next.missing) {
    console.warn("register() gate not found in kitifi-free-wifi.js");
    return;
  }
  if (!next.changed) {
    console.log("register() already rejects when free WiFi is disabled");
    return;
  }
  fs.writeFileSync(p, next.src);
  console.log("patched lib/kitifi-free-wifi.js register() for all disabled KiTifi sites");
}

const FREE_PAGE_ORIGINAL = `    if (!data.registered) {
      setBadge(data, !!data.enabled);
      if (head) {
        head.textContent = data.enabled
          ? "Fill up the form below, then tap Register to connect."
          : "Registration is open. Free internet will activate when enabled by admin.";
      }
      show("stepRegister");
      return;
    }`;

const FREE_PAGE_FIFTH_ONLY = `    if (String(routerId) === "45" && !data.enabled) {
      setBadge(data, false);
      var title = $("headTitle");
      if (title) title.textContent = "Free internet not available";
      if (head) head.textContent = data.message || "Free internet not available.";
      var dm = $("disabledMsg");
      if (dm) dm.textContent = data.message || "Free WiFi is not available right now.";
      show("stepDisabled");
      return;
    }

    if (!data.registered) {
      setBadge(data, !!data.enabled);
      if (head) {
        head.textContent = data.enabled
          ? "Fill up the form below, then tap Register to connect."
          : "Registration is open. Free internet will activate when enabled by admin.";
      }
      show("stepRegister");
      return;
    }`;

const FREE_PAGE_GLOBAL = `    if (!data.enabled) {
      setBadge(data, false);
      var title = $("headTitle");
      if (title && !isPanisijan) title.textContent = "Free internet not available";
      if (head) head.textContent = data.message || "Free internet not available.";
      var dm = $("disabledMsg");
      if (dm) dm.textContent = data.message || "Free WiFi is not available right now.";
      show("stepDisabled");
      return;
    }

    if (!data.registered) {
      setBadge(data, true);
      if (head) head.textContent = "Fill up the form below, then tap Register to connect.";
      show("stepRegister");
      return;
    }`;

export function patchFreeInternetHidesRegisterWhenDisabled(src) {
  let out = String(src || "");
  if (out.includes(FREE_PAGE_GLOBAL)) return { src: out, changed: false };
  if (out.includes(FREE_PAGE_FIFTH_ONLY)) {
    return { src: out.split(FREE_PAGE_FIFTH_ONLY).join(FREE_PAGE_GLOBAL), changed: true };
  }
  if (!out.includes(FREE_PAGE_ORIGINAL)) {
    return { src: out, changed: false, missing: true };
  }
  return { src: out.split(FREE_PAGE_ORIGINAL).join(FREE_PAGE_GLOBAL), changed: true };
}

function patchLiveFreeInternetPage() {
  const p = path.join(ROOT, "public/kitifi/free-internet.html");
  if (!fs.existsSync(p)) {
    console.log("public/kitifi/free-internet.html not in this tree (ok on git-only checkout)");
    return;
  }
  const cur = fs.readFileSync(p, "utf8");
  const next = patchFreeInternetHidesRegisterWhenDisabled(cur);
  if (next.missing) {
    console.warn("applyStatus() register branch not found in free-internet.html");
    return;
  }
  if (!next.changed) {
    console.log("free-internet.html already hides Register when disabled");
    return;
  }
  fs.writeFileSync(p, next.src);
  console.log("patched public/kitifi/free-internet.html — Register form only when enabled (Panisijan)");
}

function patchSharedPortalTemplate(html) {
  const full = path.join(ROOT, "public/kitifi/status-portal-full.html");
  if (!fs.existsSync(full)) return;
  const cur = fs.readFileSync(full, "utf8");
  const next = stripRegisterClaimFree(cur);
  if (next === cur) {
    console.log("status-portal-full.html already has no Register / Claim Free");
    return;
  }
  fs.writeFileSync(full, next);
  console.log("stripped Register / Claim Free from public/kitifi/status-portal-full.html");
}

async function pushOnePortal(row, html) {
  const { RouterOSAPI } = await import("../lib/routeros-api.js");
  const { kitifiLogin, kitifiAdminBase } = await import("../lib/kitifi-remote.js");
  const rid = Number(row.id);
  const conn = new RouterOSAPI({
    host: String(row.host).split(":")[0],
    user: row.username,
    password: row.password,
    port: Number(row.port) || 8728,
    ssl: !!row.ssl,
    timeout: Number(process.env.KITIFI_TIMEOUT_MS || 45000),
  });
  await conn.identity();
  const cookie = await kitifiLogin(conn, rid);

  async function kitifiPost(body) {
    const r = await conn.talk([
      "/tool/fetch",
      "=url=" + kitifiAdminBase(rid) + "/api/pages/settings",
      "=mode=http",
      "=http-method=post",
      "=http-header-field=Cookie: " + cookie + "\r\nContent-Type: application/json",
      "=http-data=" + JSON.stringify(body),
      "=output=user-with-headers",
      "=check-certificate=no",
    ]);
    return (r || []).map((x) => x.data || "").join("");
  }

  const htmlRes = await kitifiPost({ action: "savehtmlportal", html_portal: html });
  if (!/"status"\s*:\s*true/i.test(htmlRes)) {
    throw new Error("savehtmlportal failed: " + htmlRes.slice(0, 200));
  }
  const settingsText = await kitifiPost({ page: "portalsettings" });
  const cur = jsonFrom(settingsText)?.data || {};
  await kitifiPost({
    ...cur,
    freetimeBtn: 0,
    hs_address: cur.hs_address || "10.0.0.1",
    voucherInput: cur.voucherInput ?? 1,
    action: "savePortalSettings",
  });
  conn.close?.();
  return htmlRes.slice(0, 120);
}

async function pushPortalHtml(ids) {
  const htmlPath = path.join(ROOT, HTML_REL);
  if (!fs.existsSync(htmlPath)) throw new Error("Missing " + HTML_REL);
  let html = fs.readFileSync(htmlPath, "utf8");
  html = stripRegisterClaimFree(html);
  assertFifthPortalHtml(html);
  fs.writeFileSync(htmlPath, html);
  console.log("ok", HTML_REL, html.length, "bytes");
  patchSharedPortalTemplate(html);

  if (!fs.existsSync(DB)) {
    console.log("No billing DB — skipped controller HTML push");
    return { ok: [], fail: [] };
  }
  const db = new DatabaseSync(DB);
  const ok = [];
  const fail = [];
  for (const id of ids) {
    if (id === PANISIJAN_ROUTER_ID) continue;
    const row = db.prepare("SELECT * FROM routers WHERE id=?").get(id);
    if (!row?.host) {
      console.log("skip router", id, "(no routers row)");
      continue;
    }
    if (isPanisijanRouter(row.id, row.name)) {
      console.log("skip Panisijan", row.id, row.name);
      continue;
    }
    process.stdout.write("portal " + row.name + " (" + id + ") ... ");
    try {
      const res = await pushOnePortal(row, html);
      console.log("ok", res);
      ok.push({ id, name: row.name });
    } catch (e) {
      console.log("FAIL", e.message);
      fail.push({ id, name: row.name, error: e.message });
    }
  }
  return { ok, fail };
}

async function main() {
  const htmlPath = path.join(ROOT, HTML_REL);
  if (fs.existsSync(htmlPath)) {
    assertFifthPortalHtml(stripRegisterClaimFree(fs.readFileSync(htmlPath, "utf8")));
    console.log("ok", HTML_REL);
  } else {
    throw new Error("Missing " + HTML_REL);
  }

  const ids = disableFreeSettings(DB);
  patchLiveRegisterGate();
  patchLiveFreeInternetPage();
  patchSharedPortalTemplate();

  if (SKIP_PORTAL) {
    console.log("SKIP_PORTAL_PUSH=1 — DB flags only. Re-run to push HTML.");
    return;
  }

  const result = await pushPortalHtml(ids);
  if (result.fail?.length) {
    console.warn(
      "Portal HTML not pushed on " +
        result.fail.length +
        " site(s). DB flags are live. Re-run when VPN is up."
    );
    process.exitCode = 2;
  } else {
    console.log("KiTifi portals: Register / Claim Free removed. BUY VOUCHER kept. Panisijan untouched.");
  }
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  main().catch((e) => {
    console.error("FAILED:", e.message);
    process.exit(1);
  });
}
