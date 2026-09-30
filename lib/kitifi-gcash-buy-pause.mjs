/**
 * Pause ALL KiTifi portal GCash buy-voucher (VPS → PayMongo → voucher).
 * Insert Coin and PPPoE/MAGSAY GCash stay. Flip kitifi_gcash_buy_enabled=1 to restore.
 */

export const GCASH_BUY_ENABLED_KEY = "kitifi_gcash_buy_enabled";
export const DEFAULT_GCASH_BUY_ENABLED = "0";
export const GCASH_BUY_PAUSED_MSG =
  "GCash buy voucher is paused. Use Insert Coin for now.";

export const STOREFRONT_GET_PATHS = [
  "/kitifi/buy-voucher-kitifi-status.html",
  "/kitifi/buy-voucher-snippet.html",
  "/kitifi/embed",
  "/kitifi/generator-buy",
];

export function isGcashBuyEnabled(raw, fallback = DEFAULT_GCASH_BUY_ENABLED) {
  const v = String(raw == null || String(raw).trim() === "" ? fallback : raw)
    .trim()
    .toLowerCase();
  return v === "1" || v === "true" || v === "on" || v === "yes";
}

export function kitifiGcashBuyPausedPage() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>GCash buy voucher paused</title>
<style>
body{font-family:sans-serif;background:#0f172a;color:#e2e8f0;margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;text-align:center}
.card{max-width:440px;background:#1e293b;border-radius:16px;padding:28px;box-shadow:0 12px 40px rgba(0,0,0,.35)}
h1{font-size:22px;margin:0 0 12px}
p{color:#94a3b8;line-height:1.55;margin:0}
</style>
</head>
<body>
<div class="card">
<h1>GCash buy voucher is paused</h1>
<p>Walang GCash voucher muna sa KiTifi portal. Gumamit ng <b>Insert Coin</b>. Pasensya na sa abala.</p>
</div>
</body>
</html>`;
}

export function stripGcashBuyFromPortalHtml(html) {
  let out = String(html || "");
  out = out.replace(
    /<button\b[^>]*\bid=["']gcashBuyBtn["'][^>]*>[\s\S]*?<\/button>\s*/gi,
    ""
  );
  out = out.replace(/\s*var BUY = "https:\/\/jmwifi\.pro\/kitifi\/generator-buy";\s*/g, "\n      ");
  out = out.replace(
    /\s*function detectPortalRouterId\(\) \{[\s\S]*?function goBuyVoucher\(\) \{[\s\S]*?if \(buyBtn\) buyBtn\.addEventListener\("click", goBuyVoucher\);\s*/g,
    "\n      "
  );
  return out;
}

export function assertPausedPortalHtml(html) {
  const text = String(html || "");
  if (/id=["']gcashBuyBtn["']/i.test(text)) {
    throw new Error("KiTifi portal HTML still has BUY VOUCHER (gcashBuyBtn)");
  }
  if (/BUY VOUCHER \(GCash\)/i.test(text)) {
    throw new Error("KiTifi portal HTML still has BUY VOUCHER (GCash)");
  }
  if (/function goBuyVoucher\s*\(/i.test(text)) {
    throw new Error("KiTifi portal HTML still has goBuyVoucher");
  }
  if (!/Insert Coin/i.test(text)) {
    throw new Error("KiTifi portal HTML is missing Insert Coin");
  }
  return true;
}

export function patchServerImport(src) {
  const marker = 'from "./lib/kitifi-server.js";';
  const extra =
    marker +
    '\nimport { isGcashBuyEnabled, kitifiGcashBuyPausedPage, GCASH_BUY_PAUSED_MSG, GCASH_BUY_ENABLED_KEY } from "./lib/kitifi-gcash-buy-pause.mjs";';
  const out = String(src || "");
  if (out.includes("lib/kitifi-gcash-buy-pause.mjs")) return { src: out, changed: false };
  if (!out.includes(marker)) return { src: out, changed: false, missing: true };
  return { src: out.replace(marker, extra), changed: true };
}

export function patchServerBuyPost(src) {
  const old =
    '    if (pathname === "/api/kitifi/buy" && req.method === "POST") {\n      let b = {}; try { b = JSON.parse((await readBody(req)) || "{}"); } catch { return send(res, 400, { ok: false, error: "Bad data." }); }';
  const neu =
    '    if (pathname === "/api/kitifi/buy" && req.method === "POST") {\n      if (!isGcashBuyEnabled(Settings.get(GCASH_BUY_ENABLED_KEY, "0"))) return send(res, 503, { ok: false, error: GCASH_BUY_PAUSED_MSG });\n      let b = {}; try { b = JSON.parse((await readBody(req)) || "{}"); } catch { return send(res, 400, { ok: false, error: "Bad data." }); }';
  const out = String(src || "");
  if (out.includes("GCASH_BUY_PAUSED_MSG") && out.includes("/api/kitifi/buy")) {
    if (out.includes(neu) || out.includes("if (!isGcashBuyEnabled(Settings.get(GCASH_BUY_ENABLED_KEY")) {
      return { src: out, changed: false };
    }
  }
  if (!out.includes(old)) return { src: out, changed: false, missing: true };
  return { src: out.replace(old, neu), changed: true };
}

export function patchStorefrontGets(src) {
  let out = String(src || "");
  let changed = false;
  let missing = [];
  const gate =
    '      if (!isGcashBuyEnabled(Settings.get(GCASH_BUY_ENABLED_KEY, "0"))) {\n' +
    '        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });\n' +
    "        return res.end(kitifiGcashBuyPausedPage());\n" +
    "      }\n";
  for (const pathname of STOREFRONT_GET_PATHS) {
    const needle = `    if (pathname === "${pathname}" && req.method === "GET") {\n`;
    if (!out.includes(needle)) {
      missing.push(pathname);
      continue;
    }
    const already = `    if (pathname === "${pathname}" && req.method === "GET") {\n${gate}`;
    if (out.includes(already)) continue;
    out = out.replace(needle, needle + gate);
    changed = true;
  }
  return { src: out, changed, missing: missing.length ? missing : undefined };
}

export function patchGeneratorRates(src) {
  const old =
    '    if (pathname === "/api/kitifi/generator-rates" && req.method === "GET") {\n' +
    '      const routerId = new URL(req.url, "http://localhost").searchParams.get("router_id") || "";\n' +
    "      return send(res, 200, {\n" +
    "        ok: true,\n" +
    "        rates: kitifiGeneratorRatesDisplay(routerId, { gcashOnly: true }),";
  const neu =
    '    if (pathname === "/api/kitifi/generator-rates" && req.method === "GET") {\n' +
    '      const routerId = new URL(req.url, "http://localhost").searchParams.get("router_id") || "";\n' +
    '      const gcashOn = isGcashBuyEnabled(Settings.get(GCASH_BUY_ENABLED_KEY, "0"));\n' +
    "      return send(res, 200, {\n" +
    "        ok: true,\n" +
    "        rates: gcashOn ? kitifiGeneratorRatesDisplay(routerId, { gcashOnly: true }) : [],\n" +
    "        gcash_buy_enabled: gcashOn,";
  const out = String(src || "");
  if (out.includes("gcash_buy_enabled: gcashOn")) return { src: out, changed: false };
  if (!out.includes(old)) return { src: out, changed: false, missing: true };
  return { src: out.replace(old, neu), changed: true };
}

export function patchKitifiConfig(src) {
  const old = "    rates: kitifiPlans(rid),\n    has_admin_pass: !!kitifiAdminPass(rid),";
  const neu =
    "    rates: kitifiPlans(rid),\n    gcash_buy_enabled: isGcashBuyEnabled(Settings.get(GCASH_BUY_ENABLED_KEY, \"0\")),\n    has_admin_pass: !!kitifiAdminPass(rid),";
  const out = String(src || "");
  if (out.includes("gcash_buy_enabled: isGcashBuyEnabled")) return { src: out, changed: false };
  if (!out.includes(old)) return { src: out, changed: false, missing: true };
  return { src: out.replace(old, neu), changed: true };
}

export function patchKitifiServerImport(src) {
  const marker = 'import { Settings } from "./db.js";';
  const extra =
    marker +
    '\nimport { isGcashBuyEnabled, GCASH_BUY_ENABLED_KEY } from "./kitifi-gcash-buy-pause.mjs";';
  const out = String(src || "");
  if (out.includes("./kitifi-gcash-buy-pause.mjs")) return { src: out, changed: false };
  if (!out.includes(marker)) return { src: out, changed: false, missing: true };
  return { src: out.replace(marker, extra), changed: true };
}

export function patchKitifiApiBuy(src) {
  const old =
    '    if (pathname === "/api/kitifi/buy" && req.method === "POST") {\n      const raw = (await readBody(req)) || "";';
  const neu =
    '    if (pathname === "/api/kitifi/buy" && req.method === "POST") {\n      if (!isGcashBuyEnabled(Settings.get("kitifi_gcash_buy_enabled", "0"))) return err(res, 503, "GCash buy voucher is paused. Use Insert Coin for now.");\n      const raw = (await readBody(req)) || "";';
  const out = String(src || "");
  if (out.includes("GCash buy voucher is paused") && out.includes("/api/kitifi/buy")) {
    return { src: out, changed: false };
  }
  if (!out.includes(old)) return { src: out, changed: false, missing: true };
  return { src: out.replace(old, neu), changed: true };
}

export function patchKitifiApiImport(src) {
  const marker = 'import { Settings, Routers, Audit, KitifiOrders } from "./db.js";';
  const extra =
    marker +
    '\nimport { isGcashBuyEnabled } from "./kitifi-gcash-buy-pause.mjs";';
  const out = String(src || "");
  if (out.includes("./kitifi-gcash-buy-pause.mjs")) return { src: out, changed: false };
  if (!out.includes(marker)) return { src: out, changed: false, missing: true };
  return { src: out.replace(marker, extra), changed: true };
}

export function patchServerJs(src) {
  let out = String(src || "");
  const steps = [patchServerImport, patchServerBuyPost, patchStorefrontGets, patchGeneratorRates];
  let changed = false;
  const missing = [];
  for (const step of steps) {
    const r = step(out);
    out = r.src;
    if (r.changed) changed = true;
    if (r.missing) missing.push(step.name + ":" + JSON.stringify(r.missing));
  }
  return { src: out, changed, missing: missing.length ? missing : undefined };
}

export function patchKitifiServerJs(src) {
  let out = String(src || "");
  const a = patchKitifiServerImport(out);
  out = a.src;
  const b = patchKitifiConfig(out);
  out = b.src;
  return {
    src: out,
    changed: !!(a.changed || b.changed),
    missing: [a.missing && "import", b.missing && "config"].filter(Boolean),
  };
}

export function patchKitifiApiJs(src) {
  let out = String(src || "");
  const a = patchKitifiApiImport(out);
  out = a.src;
  const b = patchKitifiApiBuy(out);
  out = b.src;
  return {
    src: out,
    changed: !!(a.changed || b.changed),
    missing: [a.missing && "import", b.missing && "buy"].filter(Boolean),
  };
}
