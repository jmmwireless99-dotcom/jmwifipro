import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  DEFAULT_GCASH_BUY_ENABLED,
  GCASH_BUY_ENABLED_KEY,
  GCASH_BUY_PAUSED_MSG,
  STOREFRONT_GET_PATHS,
  assertPausedPortalHtml,
  isGcashBuyEnabled,
  kitifiGcashBuyPausedPage,
  patchKitifiApiJs,
  patchKitifiServerJs,
  patchServerJs,
  stripGcashBuyFromPortalHtml,
} from "../lib/kitifi-gcash-buy-pause.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HTML = path.join(ROOT, "public/kitifi/status-portal-5th.html");
const SCRIPT = path.join(ROOT, "deploy/pause-kitifi-gcash-buy.mjs");

test("GCash buy defaults to paused", () => {
  assert.equal(GCASH_BUY_ENABLED_KEY, "kitifi_gcash_buy_enabled");
  assert.equal(DEFAULT_GCASH_BUY_ENABLED, "0");
  assert.equal(isGcashBuyEnabled(""), false);
  assert.equal(isGcashBuyEnabled(undefined), false);
  assert.equal(isGcashBuyEnabled("0"), false);
  assert.equal(isGcashBuyEnabled("off"), false);
  assert.equal(isGcashBuyEnabled("1"), true);
  assert.equal(isGcashBuyEnabled("true"), true);
  assert.equal(isGcashBuyEnabled("on"), true);
});

test("paused page has no PayMongo / buy QR and tells clients to Insert Coin", () => {
  const page = kitifiGcashBuyPausedPage();
  assert.match(page, /GCash buy voucher is paused/i);
  assert.match(page, /Insert Coin/i);
  assert.doesNotMatch(page, /api\/kitifi\/buy/i);
  assert.doesNotMatch(page, /paymongo/i);
  assert.match(GCASH_BUY_PAUSED_MSG, /paused/i);
});

test("repo portal HTML has no BUY VOUCHER GCash button", () => {
  const html = fs.readFileSync(HTML, "utf8");
  assertPausedPortalHtml(html);
  assert.match(html, /Insert Coin/);
  assert.doesNotMatch(html, /id=["']gcashBuyBtn["']/i);
  assert.doesNotMatch(html, /goBuyVoucher/);
});

test("stripGcashBuyFromPortalHtml removes leftover buy button and click handler", () => {
  const dirty =
    '<button type="button" id="insertBtn">Insert Coin</button>' +
    '<button type="button" class="btn btn-primary" id="gcashBuyBtn">BUY VOUCHER (GCash)</button>' +
    '<script>var BUY = "https://jmwifi.pro/kitifi/generator-buy";' +
    "function detectPortalRouterId() { return \"36\"; }" +
    "function goBuyVoucher() { location.href = BUY; }" +
    'var buyBtn = document.getElementById("gcashBuyBtn");' +
    'if (buyBtn) buyBtn.addEventListener("click", goBuyVoucher);</script>';
  const clean = stripGcashBuyFromPortalHtml(dirty);
  assertPausedPortalHtml(clean);
  assert.equal(clean.includes("gcashBuyBtn"), false);
  assert.equal(clean.includes("goBuyVoucher"), false);
  assert.match(clean, /Insert Coin/);
});

test("deploy script pauses every KiTifi site and does not touch PPPoE pay-start", () => {
  const src = fs.readFileSync(SCRIPT, "utf8");
  assert.match(src, /GCASH_BUY_ENABLED_KEY/);
  assert.match(src, /stripGcashBuyFromPortalHtml/);
  assert.match(src, /skip PPPoE/);
  assert.match(src, /systemctl restart jm-billing/);
  assert.doesNotMatch(src, /\/api\/pay-start/);
  assert.doesNotMatch(src, /createQrph/);
});

test("server.js patches block /api/kitifi/buy and storefront GETs", () => {
  let src =
    'import { kitifiConfig } from "./lib/kitifi-server.js";\n' +
    STOREFRONT_GET_PATHS.map(
      (p) => `    if (pathname === "${p}" && req.method === "GET") {\n      try {`
    ).join("\n") +
    "\n" +
    '    if (pathname === "/api/kitifi/buy" && req.method === "POST") {\n' +
    '      let b = {}; try { b = JSON.parse((await readBody(req)) || "{}"); } catch { return send(res, 400, { ok: false, error: "Bad data." }); }\n' +
    '    if (pathname === "/api/kitifi/generator-rates" && req.method === "GET") {\n' +
    '      const routerId = new URL(req.url, "http://localhost").searchParams.get("router_id") || "";\n' +
    "      return send(res, 200, {\n" +
    "        ok: true,\n" +
    "        rates: kitifiGeneratorRatesDisplay(routerId, { gcashOnly: true }),";
  const patched = patchServerJs(src);
  assert.equal(patched.changed, true);
  assert.equal(patched.missing, undefined);
  assert.match(patched.src, /lib\/kitifi-gcash-buy-pause\.mjs/);
  assert.match(patched.src, /GCASH_BUY_PAUSED_MSG/);
  assert.match(patched.src, /kitifiGcashBuyPausedPage/);
  assert.match(patched.src, /gcash_buy_enabled: gcashOn/);
  for (const p of STOREFRONT_GET_PATHS) {
    assert.match(patched.src, new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  const again = patchServerJs(patched.src);
  assert.equal(again.changed, false);
});

test("kitifi-server config advertises gcash_buy_enabled", () => {
  const src =
    'import { Settings } from "./db.js";\nexport function kitifiConfig(routerId) {\n  return {\n    rates: kitifiPlans(rid),\n    has_admin_pass: !!kitifiAdminPass(rid),\n  };\n}';
  const patched = patchKitifiServerJs(src);
  assert.equal(patched.changed, true);
  assert.match(patched.src, /gcash_buy_enabled: isGcashBuyEnabled/);
  assert.equal(patchKitifiServerJs(patched.src).changed, false);
});

test("kitifi-api.js buy POST is gated", () => {
  const src =
    'import { Settings, Routers, Audit, KitifiOrders } from "./db.js";\n' +
    '    if (pathname === "/api/kitifi/buy" && req.method === "POST") {\n      const raw = (await readBody(req)) || "";';
  const patched = patchKitifiApiJs(src);
  assert.equal(patched.changed, true);
  assert.match(patched.src, /GCash buy voucher is paused/);
  assert.equal(patchKitifiApiJs(patched.src).changed, false);
});
