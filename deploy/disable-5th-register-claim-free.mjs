/**
 * 5thserver (KiTifi router 45) — remove Register / Claim Free from the portal.
 *
 * - Turns off jmwifi.pro free-internet for router 45 only
 *   (kitifi_free_enabled_45=0). Other sites are unchanged.
 * - Pushes public/kitifi/status-portal-5th.html (no Register / Claim Free
 *   buttons; BUY VOUCHER + Insert Coin stay).
 * - Hides native KiTifi "Claim Free Time" (freetimeBtn=0).
 *
 * Usage on VPS:
 *   cd /opt/jm-billing && node deploy/disable-5th-register-claim-free.mjs
 *   systemctl restart jm-billing
 *
 * If MikroTik VPN is down, the DB flag still applies immediately. Re-run
 * this script later to push the portal HTML.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

export const FIFTH_SERVER_ROUTER_ID = 45;
export const FIFTH_SERVER_NAME = "5thserver";
export const FREE_ENABLED_KEY = "kitifi_free_enabled_" + FIFTH_SERVER_ROUTER_ID;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DB = process.env.BILLING_DB || process.env.DB_FILE || path.join(ROOT, "billing.db");
const HTML_REL = "public/kitifi/status-portal-5th.html";
const SKIP_PORTAL = process.env.SKIP_PORTAL_PUSH === "1";

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
    throw new Error("5th portal HTML still has Register / freeWifiBtn");
  }
  if (/Create account to get free internet/i.test(text)) {
    throw new Error("5th portal HTML still has Register copy");
  }
  if (/Claim Free Time/i.test(text)) {
    throw new Error("5th portal HTML still has Claim Free Time");
  }
  if (!/id=["']gcashBuyBtn["']/i.test(text) || !/BUY VOUCHER/i.test(text)) {
    throw new Error("5th portal HTML is missing BUY VOUCHER");
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

function disableFreeSetting(dbPath) {
  if (!fs.existsSync(dbPath)) {
    console.log("DB not found (ok if copying files only):", dbPath);
    return false;
  }
  const db = new DatabaseSync(dbPath);
  const upsert = db.prepare(
    "INSERT INTO settings (k,v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v"
  );
  upsert.run(FREE_ENABLED_KEY, "0");
  const row = db.prepare("SELECT v FROM settings WHERE k=?").get(FREE_ENABLED_KEY);
  console.log(FREE_ENABLED_KEY + "=" + (row?.v ?? "?") + " (OFF)");
  return true;
}

const REGISTER_NEEDLE =
  "const rid = Number(routerId) || kitifiPortalRouterId();\n      const existing = byMac(m, rid);";
const REGISTER_PATCH =
  "const rid = Number(routerId) || kitifiPortalRouterId();\n" +
  "      if (!kitifiFreeSettings(rid).enabled) throw new Error(\"Free internet is disabled.\");\n" +
  "      const existing = byMac(m, rid);";

export function patchRegisterRejectsDisabled(src) {
  if (src.includes('if (!kitifiFreeSettings(rid).enabled) throw new Error("Free internet is disabled.")')) {
    return { src, changed: false };
  }
  if (!src.includes(REGISTER_NEEDLE)) {
    return { src, changed: false, missing: true };
  }
  return { src: src.split(REGISTER_NEEDLE).join(REGISTER_PATCH), changed: true };
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
  console.log("patched lib/kitifi-free-wifi.js register() to honor per-router enabled flag");
}

async function pushPortalHtml() {
  const htmlPath = path.join(ROOT, HTML_REL);
  if (!fs.existsSync(htmlPath)) throw new Error("Missing " + HTML_REL);
  let html = fs.readFileSync(htmlPath, "utf8");
  html = stripRegisterClaimFree(html);
  assertFifthPortalHtml(html);

  const destHtml = path.join(ROOT, "public/kitifi/status-portal-5th.html");
  fs.mkdirSync(path.dirname(destHtml), { recursive: true });
  if (path.resolve(htmlPath) !== path.resolve(destHtml)) {
    fs.writeFileSync(destHtml, html);
  } else {
    fs.writeFileSync(destHtml, html);
  }
  console.log("ok", HTML_REL, html.length, "bytes");

  const { RouterOSAPI } = await import("../lib/routeros-api.js");
  const {
    kitifiLogin,
    kitifiAdminBase,
  } = await import("../lib/kitifi-remote.js");

  const db = new DatabaseSync(DB);
  const row = db.prepare("SELECT * FROM routers WHERE id=?").get(FIFTH_SERVER_ROUTER_ID);
  if (!row?.host) throw new Error("Router " + FIFTH_SERVER_ROUTER_ID + " not found");
  console.log("Router:", row.name, row.host + ":" + row.port);

  const conn = new RouterOSAPI({
    host: String(row.host).split(":")[0],
    user: row.username,
    password: row.password,
    port: Number(row.port) || 8728,
    ssl: !!row.ssl,
    timeout: Number(process.env.KITIFI_TIMEOUT_MS || 45000),
  });

  await conn.identity();
  const cookie = await kitifiLogin(conn, FIFTH_SERVER_ROUTER_ID);

  async function kitifiPost(body) {
    const r = await conn.talk([
      "/tool/fetch",
      "=url=" + kitifiAdminBase(FIFTH_SERVER_ROUTER_ID) + "/api/pages/settings",
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
  console.log("savehtmlportal:", htmlRes.slice(0, 160));
  if (!/"status"\s*:\s*true/i.test(htmlRes)) {
    throw new Error("savehtmlportal failed: " + htmlRes.slice(0, 200));
  }

  const settingsText = await kitifiPost({ page: "portalsettings" });
  const cur = jsonFrom(settingsText)?.data || {};
  const save = await kitifiPost({
    ...cur,
    freetimeBtn: 0,
    hs_address: cur.hs_address || "10.0.0.1",
    voucherInput: cur.voucherInput ?? 1,
    action: "savePortalSettings",
  });
  console.log("savePortalSettings:", save.slice(0, 160));
  conn.close?.();
  console.log("5thserver portal: Register / Claim Free removed. BUY VOUCHER kept.");
}

async function main() {
  const htmlPath = path.join(ROOT, HTML_REL);
  if (fs.existsSync(htmlPath)) {
    assertFifthPortalHtml(fs.readFileSync(htmlPath, "utf8"));
    console.log("ok", HTML_REL);
  } else {
    throw new Error("Missing " + HTML_REL);
  }

  disableFreeSetting(DB);
  patchLiveRegisterGate();

  if (SKIP_PORTAL) {
    console.log("SKIP_PORTAL_PUSH=1 — DB flag only. Re-run to push HTML.");
    return;
  }

  try {
    await pushPortalHtml();
  } catch (e) {
    console.warn("Portal HTML not pushed (VPN/router unreachable):", e.message);
    console.warn("kitifi_free_enabled_45=0 is live on jmwifi.pro. Re-run this script when 5thserver API is up.");
    process.exitCode = 2;
  }
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  main().catch((e) => {
    console.error("FAILED:", e.message);
    process.exit(1);
  });
}
