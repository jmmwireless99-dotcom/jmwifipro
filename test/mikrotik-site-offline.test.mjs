import test from "node:test";
import assert from "node:assert/strict";
import {
  SITE_ONLINE_KEY_PREFIX,
  SITE_OFFLINE_MSG,
  siteOnlineKey,
  isSiteOnlineFlag,
  kitifiSiteOfflinePage,
  offlineStatusMessage,
  SSTP_TUNNEL_MAP,
  patchServerJs,
} from "../lib/mikrotik-site-offline.mjs";

test("site online key + flag parsing", () => {
  assert.equal(siteOnlineKey(51), SITE_ONLINE_KEY_PREFIX + "51");
  assert.equal(isSiteOnlineFlag(""), true); // fail-open when unset
  assert.equal(isSiteOnlineFlag(undefined), true);
  assert.equal(isSiteOnlineFlag("0"), false);
  assert.equal(isSiteOnlineFlag("1"), true);
  assert.equal(isSiteOnlineFlag("off"), false);
});

test("offline page + status message", () => {
  const html = kitifiSiteOfflinePage("PANISIJAN-CCTV");
  assert.match(html, /PANISIJAN-CCTV is offline/);
  assert.match(html, /Insert Coin/);
  assert.match(SITE_OFFLINE_MSG, /offline/i);
  assert.match(offlineStatusMessage(51), /panisijan-free-equ4/);
  assert.equal(SSTP_TUNNEL_MAP[45].tip, "10.90.0.22");
});

test("server patches apply to live-shaped snippets", () => {
  const src =
    'import { isGcashBuyEnabled, kitifiGcashBuyPausedPage, GCASH_BUY_PAUSED_MSG, GCASH_BUY_ENABLED_KEY } from "./lib/kitifi-gcash-buy-pause.mjs";\n' +
    "function kitifiPortalRouterId(x){ return x; }\n" +
    '    if (pathname === "/kitifi/generator-buy" && req.method === "GET") {\n' +
    "      if (!isGcashBuyEnabled(Settings.get(GCASH_BUY_ENABLED_KEY, \"0\"))) {\n" +
    '        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });\n' +
    "        return res.end(kitifiGcashBuyPausedPage());\n" +
    "      }\n" +
    "      try {\n" +
    '    if (pathname === "/api/kitifi/buy" && req.method === "POST") {\n' +
    "      if (!isGcashBuyEnabled(Settings.get(GCASH_BUY_ENABLED_KEY, \"0\"))) return send(res, 503, { ok: false, error: GCASH_BUY_PAUSED_MSG });\n" +
    '      let b = {}; try { b = JSON.parse((await readBody(req)) || "{}"); } catch { return send(res, 400, { ok: false, error: "Bad data." }); }\n' +
    "      const portalRouterId = resolveKitifiBuyRouterId(kitifiPortalRouterId(b.router_id));\n" +
    "      const plan = kitifiPlanById(String(b.plan_id || \"\").trim(), portalRouterId);\n" +
    "      const gcashOn = isGcashBuyEnabled(Settings.get(GCASH_BUY_ENABLED_KEY, \"0\"));\n" +
    "      return send(res, 200, {\n" +
    "        ok: true,\n" +
    "        rates: gcashOn ? kitifiGeneratorRatesDisplay(routerId, { gcashOnly: true }) : [],\n" +
    "        gcash_buy_enabled: gcashOn,\n" +
    '    if (pathname === "/api/kitifi/free/claim" && req.method === "POST") {\n' +
    '      let b = {}; try { b = JSON.parse((await readBody(req)) || "{}"); } catch { return send(res, 400, { ok: false, error: "Bad data." }); }\n' +
    "      const rid = Number(b.router_id) || kitifiPortalRouterId();\n" +
    "      try {";

  const first = patchServerJs(src);
  assert.equal(first.changed, true);
  assert.match(first.src, /mikrotik-site-offline\.mjs/);
  assert.match(first.src, /function kitifiSiteIsOnline/);
  assert.match(first.src, /kitifiSiteIsOnline\(portalRouterId\)/);
  assert.match(first.src, /site_online: siteOn/);
  assert.match(first.src, /kitifiSiteOfflinePage/);
  assert.match(first.src, /kitifiSiteIsOnline\(rid\)/);

  const again = patchServerJs(first.src);
  assert.equal(again.changed, false);
});
