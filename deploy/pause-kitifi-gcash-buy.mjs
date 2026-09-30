/**
 * Pause ALL KiTifi GCash buy-voucher (portal button + VPS PayMongo QR).
 * Insert Coin stays. PPPoE / MAGSAY GCash is not touched.
 *
 * Usage on VPS:
 *   cd /opt/jm-billing && node deploy/pause-kitifi-gcash-buy.mjs
 *   (script restarts jm-billing unless SKIP_RESTART=1)
 *
 * Restore later:
 *   sqlite3 billing.db "INSERT INTO settings(k,v) VALUES('kitifi_gcash_buy_enabled','1') ON CONFLICT(k) DO UPDATE SET v='1';"
 *   systemctl restart jm-billing
 *   then restore the BUY VOUCHER button in portal HTML.
 */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import {
  GCASH_BUY_ENABLED_KEY,
  DEFAULT_GCASH_BUY_ENABLED,
  stripGcashBuyFromPortalHtml,
  assertPausedPortalHtml,
  patchServerJs,
  patchKitifiServerJs,
  patchKitifiApiJs,
  kitifiGcashBuyPausedPage,
} from "../lib/kitifi-gcash-buy-pause.mjs";
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

export function pauseGcashBuySetting(dbPath) {
  if (!fs.existsSync(dbPath)) {
    console.log("DB not found (ok if copying files only):", dbPath);
    return [];
  }
  const db = new DatabaseSync(dbPath);
  db.prepare(
    "INSERT INTO settings (k,v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v"
  ).run(GCASH_BUY_ENABLED_KEY, DEFAULT_GCASH_BUY_ENABLED);
  const ids = collectKitifiIds(db);
  console.log(GCASH_BUY_ENABLED_KEY + "=" + DEFAULT_GCASH_BUY_ENABLED);
  console.log("kitifi ids", ids.join(",") || "(none)");
  return ids;
}

function writeIfChanged(file, next) {
  const cur = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  if (cur === next) {
    console.log("unchanged", path.relative(ROOT, file));
    return false;
  }
  if (!DRY) fs.writeFileSync(file, next);
  console.log((DRY ? "would patch " : "patched ") + path.relative(ROOT, file));
  return true;
}

function patchFile(rel, fn) {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) {
    console.log("skip missing", rel);
    return;
  }
  const cur = fs.readFileSync(p, "utf8");
  const next = fn(cur);
  if (next.missing && next.missing.length) {
    console.warn("patch incomplete", rel, next.missing);
  }
  if (!next.changed) {
    console.log("already patched", rel);
    return;
  }
  writeIfChanged(p, next.src);
}

function patchLiveSources() {
  patchFile("server.js", patchServerJs);
  patchFile("lib/kitifi-server.js", patchKitifiServerJs);
  patchFile("lib/kitifi-api.js", patchKitifiApiJs);

  const pausedPath = path.join(ROOT, "public/kitifi/gcash-buy-paused.html");
  if (!DRY) fs.writeFileSync(pausedPath, kitifiGcashBuyPausedPage());
  console.log("ok public/kitifi/gcash-buy-paused.html");

  const full = path.join(ROOT, "public/kitifi/status-portal-full.html");
  if (fs.existsSync(full)) {
    const cur = fs.readFileSync(full, "utf8");
    const next = stripGcashBuyFromPortalHtml(cur);
    if (next !== cur) writeIfChanged(full, next);
    else console.log("status-portal-full.html already has no BUY VOUCHER");
  }
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
  if (!fs.existsSync(htmlPath)) throw new Error("Missing " + HTML_REL);
  let html = fs.readFileSync(htmlPath, "utf8");
  html = stripGcashBuyFromPortalHtml(html);
  assertPausedPortalHtml(html);
  if (!DRY) fs.writeFileSync(htmlPath, html);
  console.log("ok", HTML_REL, html.length, "bytes");

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
    if (/pppoe/i.test(String(row.name || ""))) {
      console.log("skip PPPoE", row.id, row.name);
      continue;
    }
    process.stdout.write("portal " + row.name + " (" + id + ") ... ");
    if (DRY) {
      console.log("dry-run");
      continue;
    }
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

function restartBilling() {
  if (SKIP_RESTART || DRY) {
    console.log("SKIP_RESTART — patch files only");
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
  const htmlPath = path.join(ROOT, HTML_REL);
  if (!fs.existsSync(htmlPath)) throw new Error("Missing " + HTML_REL);
  const html = stripGcashBuyFromPortalHtml(fs.readFileSync(htmlPath, "utf8"));
  assertPausedPortalHtml(html);
  if (!DRY) fs.writeFileSync(htmlPath, html);
  console.log("ok", HTML_REL);

  const ids = DRY ? [] : pauseGcashBuySetting(DB);
  patchLiveSources();
  restartBilling();

  if (SKIP_PORTAL) {
    console.log("SKIP_PORTAL_PUSH=1 — API/DB pause only. Re-run to push HTML.");
    return;
  }

  const result = await pushPortalHtml(ids.length ? ids : collectKitifiIds(new DatabaseSync(DB)));
  if (result.fail?.length) {
    console.warn(
      "Portal HTML not pushed on " +
        result.fail.length +
        " site(s). GCash buy API is paused. Re-run when VPN is up."
    );
    process.exitCode = 2;
  } else {
    console.log("KiTifi GCash buy paused. BUY VOUCHER removed. Insert Coin kept.");
  }
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  main().catch((e) => {
    console.error("FAILED:", e.message);
    process.exit(1);
  });
}
