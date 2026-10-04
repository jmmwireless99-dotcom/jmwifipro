/**
 * Per-site online gate for KiTifi when MikroTik SSTP to jmtechsolution.cloud is down.
 * Setting: kitifi_site_online_<routerId> = 1|0
 * Deploy probe updates the flag; buy/claim/rates refuse offline sites with a clear message.
 */

export const SITE_ONLINE_KEY_PREFIX = "kitifi_site_online_";
export const SITE_OFFLINE_MSG =
  "This WiFi site is offline (VPN/SSTP down). Try Insert Coin, or wait until the site reconnects.";

export function siteOnlineKey(routerId) {
  return SITE_ONLINE_KEY_PREFIX + String(Number(routerId) || routerId || "").trim();
}

export function isSiteOnlineFlag(raw, fallback = "1") {
  const v = String(raw == null || String(raw).trim() === "" ? fallback : raw)
    .trim()
    .toLowerCase();
  // missing key => assume online (fail-open for untouched sites)
  if (raw == null || String(raw).trim() === "") return true;
  return v === "1" || v === "true" || v === "on" || v === "yes";
}

export function kitifiSiteOfflinePage(siteName = "This site") {
  const name = String(siteName || "This site").replace(/[<>&]/g, "");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Site offline</title>
<style>
body{font-family:sans-serif;background:#0f172a;color:#e2e8f0;margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;text-align:center}
.card{max-width:440px;background:#1e293b;border-radius:16px;padding:28px;box-shadow:0 12px 40px rgba(0,0,0,.35)}
h1{font-size:22px;margin:0 0 12px}
p{color:#94a3b8;line-height:1.55;margin:0}
</style>
</head>
<body>
<div class="card">
<h1>${name} is offline</h1>
<p>Hindi muna available ang GCash buy / free claim dito — VPN (SSTP) ng site ay down. Gumamit ng <b>Insert Coin</b> kung available, o subukan ulit mamaya.</p>
</div>
</body>
</html>`;
}

/** Known SSTP tunnel map used by billing (accel on jmtechsolution.cloud). */
export const SSTP_TUNNEL_MAP = {
  39: { name: "CAWAYAN-SERVER", user: "cawayan-server-mrol", tip: "10.90.0.25", port: 57423 },
  45: { name: "5thserver", user: "5thserver-mxw5", tip: "10.90.0.22", port: 51341 },
  48: { name: "CAGBATANG", user: "cabatangan-kitifi-9pe6", tip: "10.90.0.17", port: 51516 },
  51: { name: "PANISIJAN-CCTV", user: "panisijan-free-equ4", tip: "10.90.0.32", port: 52314 },
  55: { name: "MAGSAYSAY-PPPOE", user: "magsaysay-pppoe-3nna", tip: "10.90.0.39", port: 52410 },
};

/** OSPF peer IPs reachable via MAGSAY2X (#53) for remote REST bounce. */
export const MAGSAY2X_OSPF_PEERS = {
  45: { ip: "20.10.206.2", label: "5TH" },
};

export function offlineStatusMessage(routerId, { tcpOpen = false, identity = null } = {}) {
  const meta = SSTP_TUNNEL_MAP[Number(routerId)];
  if (tcpOpen && identity) return "ok";
  if (!meta) return "fail: tunnel/port down";
  return (
    "fail: SSTP not connected to jmtechsolution.cloud (map OK " +
    meta.tip +
    " :" +
    meta.port +
    "). On-site: enable sstp-cctv user " +
    meta.user
  );
}

export function patchServerImport(src) {
  const marker = 'from "./lib/kitifi-gcash-buy-pause.mjs";';
  const extra =
    marker +
    '\nimport { isSiteOnlineFlag, siteOnlineKey, kitifiSiteOfflinePage, SITE_OFFLINE_MSG } from "./lib/mikrotik-site-offline.mjs";';
  const out = String(src || "");
  if (out.includes("lib/mikrotik-site-offline.mjs")) return { src: out, changed: false };
  if (!out.includes(marker)) return { src: out, changed: false, missing: true };
  return { src: out.replace(marker, extra), changed: true };
}

function helperBlock() {
  return (
    "\nfunction kitifiSiteIsOnline(rid) {\n" +
    "  const id = Number(rid) || 0;\n" +
    "  if (!id) return true;\n" +
    "  return isSiteOnlineFlag(Settings.get(siteOnlineKey(id), \"\"));\n" +
    "}\n"
  );
}

export function patchServerHelper(src) {
  const out = String(src || "");
  if (out.includes("function kitifiSiteIsOnline(")) return { src: out, changed: false };
  const marker = "function kitifiPortalRouterId";
  const idx = out.indexOf(marker);
  if (idx < 0) return { src: out, changed: false, missing: true };
  return { src: out.slice(0, idx) + helperBlock() + out.slice(idx), changed: true };
}

export function patchServerBuyPost(src) {
  const old =
    '    if (pathname === "/api/kitifi/buy" && req.method === "POST") {\n' +
    "      if (!isGcashBuyEnabled(Settings.get(GCASH_BUY_ENABLED_KEY, \"0\"))) return send(res, 503, { ok: false, error: GCASH_BUY_PAUSED_MSG });\n" +
    '      let b = {}; try { b = JSON.parse((await readBody(req)) || "{}"); } catch { return send(res, 400, { ok: false, error: "Bad data." }); }\n' +
    "      const portalRouterId = resolveKitifiBuyRouterId(kitifiPortalRouterId(b.router_id));";
  const neu =
    '    if (pathname === "/api/kitifi/buy" && req.method === "POST") {\n' +
    "      if (!isGcashBuyEnabled(Settings.get(GCASH_BUY_ENABLED_KEY, \"0\"))) return send(res, 503, { ok: false, error: GCASH_BUY_PAUSED_MSG });\n" +
    '      let b = {}; try { b = JSON.parse((await readBody(req)) || "{}"); } catch { return send(res, 400, { ok: false, error: "Bad data." }); }\n' +
    "      const portalRouterId = resolveKitifiBuyRouterId(kitifiPortalRouterId(b.router_id));\n" +
    "      if (!kitifiSiteIsOnline(portalRouterId)) return send(res, 503, { ok: false, error: SITE_OFFLINE_MSG });";
  const out = String(src || "");
  if (out.includes("kitifiSiteIsOnline(portalRouterId)") && out.includes("/api/kitifi/buy")) {
    return { src: out, changed: false };
  }
  if (!out.includes(old)) return { src: out, changed: false, missing: true };
  return { src: out.replace(old, neu), changed: true };
}

export function patchServerGeneratorRates(src) {
  const old =
    "      const gcashOn = isGcashBuyEnabled(Settings.get(GCASH_BUY_ENABLED_KEY, \"0\"));\n" +
    "      return send(res, 200, {\n" +
    "        ok: true,\n" +
    "        rates: gcashOn ? kitifiGeneratorRatesDisplay(routerId, { gcashOnly: true }) : [],\n" +
    "        gcash_buy_enabled: gcashOn,";
  const neu =
    "      const gcashOn = isGcashBuyEnabled(Settings.get(GCASH_BUY_ENABLED_KEY, \"0\"));\n" +
    "      const siteOn = kitifiSiteIsOnline(routerId);\n" +
    "      return send(res, 200, {\n" +
    "        ok: true,\n" +
    "        rates: gcashOn && siteOn ? kitifiGeneratorRatesDisplay(routerId, { gcashOnly: true }) : [],\n" +
    "        gcash_buy_enabled: gcashOn && siteOn,\n" +
    "        site_online: siteOn,\n" +
    "        site_offline_msg: siteOn ? \"\" : SITE_OFFLINE_MSG,";
  const out = String(src || "");
  if (out.includes("site_online: siteOn")) return { src: out, changed: false };
  if (!out.includes(old)) return { src: out, changed: false, missing: true };
  return { src: out.replace(old, neu), changed: true };
}

export function patchServerGeneratorBuyGet(src) {
  const old =
    '    if (pathname === "/kitifi/generator-buy" && req.method === "GET") {\n' +
    "      if (!isGcashBuyEnabled(Settings.get(GCASH_BUY_ENABLED_KEY, \"0\"))) {\n" +
    '        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });\n' +
    "        return res.end(kitifiGcashBuyPausedPage());\n" +
    "      }\n";
  const neu =
    '    if (pathname === "/kitifi/generator-buy" && req.method === "GET") {\n' +
    "      if (!isGcashBuyEnabled(Settings.get(GCASH_BUY_ENABLED_KEY, \"0\"))) {\n" +
    '        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });\n' +
    "        return res.end(kitifiGcashBuyPausedPage());\n" +
    "      }\n" +
    "      {\n" +
    '        const rid = String(new URL(req.url, "http://localhost").searchParams.get("router_id") || "");\n' +
    "        const resolved = resolveKitifiBuyRouterId(rid || kitifiPortalRouterId());\n" +
    "        if (resolved && !kitifiSiteIsOnline(resolved)) {\n" +
    '          const row = Routers.get(Number(resolved));\n' +
    '          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });\n' +
    "          return res.end(kitifiSiteOfflinePage(row?.name || (\"Router \" + resolved)));\n" +
    "        }\n" +
    "      }\n";
  const out = String(src || "");
  if (out.includes("kitifiSiteOfflinePage(") && out.includes("/kitifi/generator-buy")) {
    return { src: out, changed: false };
  }
  if (!out.includes(old)) return { src: out, changed: false, missing: true };
  return { src: out.replace(old, neu), changed: true };
}

export function patchServerFreeClaim(src) {
  const old =
    '    if (pathname === "/api/kitifi/free/claim" && req.method === "POST") {\n' +
    '      let b = {}; try { b = JSON.parse((await readBody(req)) || "{}"); } catch { return send(res, 400, { ok: false, error: "Bad data." }); }\n' +
    "      const rid = Number(b.router_id) || kitifiPortalRouterId();\n" +
    "      try {";
  const neu =
    '    if (pathname === "/api/kitifi/free/claim" && req.method === "POST") {\n' +
    '      let b = {}; try { b = JSON.parse((await readBody(req)) || "{}"); } catch { return send(res, 400, { ok: false, error: "Bad data." }); }\n' +
    "      const rid = Number(b.router_id) || kitifiPortalRouterId();\n" +
    "      if (!kitifiSiteIsOnline(rid)) return send(res, 503, { ok: false, error: SITE_OFFLINE_MSG });\n" +
    "      try {";
  const out = String(src || "");
  if (out.includes("/api/kitifi/free/claim") && out.includes("kitifiSiteIsOnline(rid)")) {
    return { src: out, changed: false };
  }
  if (!out.includes(old)) return { src: out, changed: false, missing: true };
  return { src: out.replace(old, neu), changed: true };
}

export function patchServerJs(src) {
  let out = String(src || "");
  let changed = false;
  const missing = [];
  for (const fn of [
    patchServerImport,
    patchServerHelper,
    patchServerBuyPost,
    patchServerGeneratorRates,
    patchServerGeneratorBuyGet,
    patchServerFreeClaim,
  ]) {
    const r = fn(out);
    if (r.missing) missing.push(fn.name);
    if (r.changed) {
      out = r.src;
      changed = true;
    } else if (r.src !== out) {
      out = r.src;
    }
  }
  return { src: out, changed, missing };
}
