/**
 * Resume KiTifi GCash BUY VOUCHER. Payment stays on jmwifi.pro (PayMongo).
 * Time is given as MikroTik /ip/hotspot/user (profile KITIFI) — not KiTifi generateVoucher.
 *
 * Also remaps deleted router rows: 3rd 36→57, 2nd 46→56, 1st 42→52.
 *
 * Usage on VPS:
 *   cd /opt/jm-billing && node deploy/resume-kitifi-gcash-mikrotik.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { GCASH_BUY_ENABLED_KEY } from "../lib/kitifi-gcash-buy-pause.mjs";
import {
  GCASH_GENERATE_KEY,
  DEFAULT_GCASH_GENERATE,
  KITIFI_DELETED_ROUTER_ALIAS,
  remapPortalSitesJson,
  patchServerBuyRouterAlias,
  patchKitifiApiFulfillAlias,
  patchMikrotikGenerateProfile,
  patchMikrotikGenerateResolveProfile,
} from "../lib/kitifi-mikrotik-direct-voucher.mjs";
import { patchKitifiServerSource } from "./enable-mikrotik-direct-gcash-voucher.mjs";
import {
  PANISIJAN_ROUTER_ID,
  isPanisijanRouter,
  collectKitifiIds,
} from "./disable-5th-register-claim-free.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DB = process.env.BILLING_DB || process.env.DB_FILE || path.join(ROOT, "billing.db");
const HTML_REL = "public/kitifi/status-portal-5th.html";
const SKIP_PORTAL = process.env.SKIP_PORTAL_PUSH === "1";
const SKIP_RESTART = process.env.SKIP_RESTART === "1";
const DRY = process.argv.includes("--dry-run");

export function assertResumePortalHtml(html) {
  const text = String(html || "");
  if (!/id=["']gcashBuyBtn["']/i.test(text) || !/BUY VOUCHER \(GCash\)/i.test(text)) {
    throw new Error("Resume portal HTML is missing BUY VOUCHER");
  }
  if (!/Insert Coin/i.test(text)) {
    throw new Error("Resume portal HTML is missing Insert Coin");
  }
  if (!/kitifiMikrotikLoginUrl/.test(text)) {
    throw new Error("Resume portal HTML must auto-connect via MikroTik login");
  }
  if (!/return "56"/.test(text) || !/return "57"/.test(text) || !/return "52"/.test(text)) {
    throw new Error("Resume portal HTML must map 2nd/3rd/1st to live router ids 56/57/52");
  }
  if (/2nd[\s\S]{0,80}return "46"/.test(text) || /3rd[\s\S]{0,80}return "36"/.test(text)) {
    throw new Error("Resume portal HTML still maps 2nd/3rd to deleted router ids");
  }
  if (/10\.0\.0\.10/.test(text) && /generateVoucher/.test(text)) {
    throw new Error("Resume portal HTML must not call KiTifi generateVoucher");
  }
  return true;
}

export function copySiteSettings(db, fromId, toId) {
  const copied = [];
  const upsert = db.prepare(
    "INSERT INTO settings (k,v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v",
  );
  for (const prefix of ["kitifi_plans_", "kitifi_hotspot_login_", "kitifi_seller_id_"]) {
    const src = db.prepare("SELECT v FROM settings WHERE k=?").get(prefix + fromId);
    if (!src?.v) continue;
    const dstKey = prefix + toId;
    const dst = db.prepare("SELECT v FROM settings WHERE k=?").get(dstKey);
    if (dst?.v) continue;
    if (!DRY) upsert.run(dstKey, src.v);
    copied.push(dstKey);
  }
  return copied;
}

export function resumeGcashBuySettings(dbPath) {
  if (!fs.existsSync(dbPath)) {
    console.log("DB not found:", dbPath);
    return { ids: [], copied: [] };
  }
  const db = new DatabaseSync(dbPath);
  try {
    const upsert = db.prepare(
      "INSERT INTO settings (k,v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v",
    );
    upsert.run(GCASH_BUY_ENABLED_KEY, "1");
    upsert.run(GCASH_GENERATE_KEY, DEFAULT_GCASH_GENERATE);
    const copied = [];
    for (const [from, to] of Object.entries(KITIFI_DELETED_ROUTER_ALIAS)) {
      copied.push(...copySiteSettings(db, Number(from), Number(to)));
    }
    const sitesRow = db.prepare("SELECT v FROM settings WHERE k=?").get("kitifi_portal_sites");
    if (sitesRow?.v) {
      const next = remapPortalSitesJson(sitesRow.v);
      if (next !== sitesRow.v && !DRY) upsert.run("kitifi_portal_sites", next);
    }
    const ids = collectKitifiIds(db);
    console.log(GCASH_BUY_ENABLED_KEY + "=1");
    console.log(GCASH_GENERATE_KEY + "=" + DEFAULT_GCASH_GENERATE);
    console.log("copied settings", copied.join(",") || "(none)");
    console.log("kitifi ids", ids.join(",") || "(none)");
    return { ids, copied };
  } finally {
    try { db.close(); } catch {}
  }
}

function patchFile(rel, fn) {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) {
    console.log("skip missing", rel);
    return;
  }
  const cur = fs.readFileSync(p, "utf8");
  const next = fn(cur);
  if (next.missing) console.warn("patch incomplete", rel, next.missing);
  if (!next.changed) {
    console.log("already patched", rel);
    return;
  }
  if (!DRY) fs.writeFileSync(p, next.src);
  console.log((DRY ? "would patch " : "patched ") + rel);
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
  conn.close?.();
  return htmlRes.slice(0, 120);
}

async function pushPortalHtml(ids) {
  const htmlPath = path.join(ROOT, HTML_REL);
  const html = fs.readFileSync(htmlPath, "utf8");
  assertResumePortalHtml(html);
  if (!fs.existsSync(DB)) return { ok: [], fail: [] };
  const db = new DatabaseSync(DB);
  const targets = [];
  try {
    for (const id of ids) {
      if (id === PANISIJAN_ROUTER_ID) continue;
      const row = db.prepare("SELECT * FROM routers WHERE id=?").get(id);
      if (!row?.host) {
        console.log("skip router", id, "(no routers row)");
        continue;
      }
      if (isPanisijanRouter(row.id, row.name) || /pppoe/i.test(String(row.name || ""))) {
        console.log("skip", row.id, row.name);
        continue;
      }
      targets.push(row);
    }
  } finally {
    try { db.close(); } catch {}
  }
  const ok = [];
  const fail = [];
  for (const row of targets) {
    process.stdout.write("portal " + row.name + " (" + row.id + ") ... ");
    if (DRY) {
      console.log("dry-run");
      continue;
    }
    try {
      const res = await pushOnePortal(row, html);
      console.log("ok", res);
      ok.push({ id: row.id, name: row.name });
    } catch (e) {
      console.log("FAIL", e.message);
      fail.push({ id: row.id, name: row.name, error: e.message });
    }
  }
  return { ok, fail };
}

function restartBilling() {
  if (SKIP_RESTART || DRY) {
    console.log("SKIP_RESTART");
    return;
  }
  try {
    execSync("systemctl restart jm-billing", { stdio: "inherit" });
    console.log("restarted jm-billing");
  } catch (e) {
    console.warn("restart failed:", e.message);
  }
}

async function main() {
  if (process.cwd() !== ROOT) {
    process.chdir(ROOT);
    console.log("cwd", ROOT);
  }
  const htmlPath = path.join(ROOT, HTML_REL);
  assertResumePortalHtml(fs.readFileSync(htmlPath, "utf8"));
  console.log("ok", HTML_REL);

  const { ids } = DRY ? { ids: [] } : resumeGcashBuySettings(DB);
  patchFile("lib/kitifi-server.js", (src) => {
    const a = patchKitifiServerSource(src);
    const b = patchMikrotikGenerateProfile(a.src);
    const c = patchMikrotikGenerateResolveProfile(b.src);
    return {
      src: c.src,
      changed: !!(a.changed || b.changed || c.changed),
      missing: b.missing || c.missing,
    };
  });
  patchFile("server.js", patchServerBuyRouterAlias);
  patchFile("lib/kitifi-api.js", patchKitifiApiFulfillAlias);
  restartBilling();

  if (SKIP_PORTAL) {
    console.log("SKIP_PORTAL_PUSH=1");
    return;
  }
  const result = await pushPortalHtml(ids);
  if (result.fail?.length) {
    console.warn(
      "Portal HTML not pushed on " +
        result.fail.length +
        " site(s). GCash buy API is live with MikroTik generate + router aliases.",
    );
    process.exitCode = 2;
  } else {
    console.log("KiTifi GCash buy ON. Voucher time is MikroTik /ip/hotspot/user.");
  }
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  main().catch((e) => {
    console.error("FAILED:", e.message);
    process.exit(1);
  });
}
