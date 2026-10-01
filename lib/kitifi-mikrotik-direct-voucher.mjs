/**
 * GCash BUY VOUCHER → MikroTik /ip/hotspot/user (skip KiTifi controller).
 * PayMongo still runs on jmwifi.pro; the voucher itself is created on the site router.
 */

export const GCASH_GENERATE_KEY = "kitifi_gcash_generate";
export const DEFAULT_GCASH_GENERATE = "mikrotik";

export function normalizeGcashGenerateMode(raw, fallback = DEFAULT_GCASH_GENERATE) {
  const v = String(raw || fallback || "").trim().toLowerCase();
  if (v === "kitifi" || v === "controller" || v === "remote") return "kitifi";
  if (v === "mikrotik" || v === "direct" || v === "") return "mikrotik";
  return "mikrotik";
}

export function shouldGenerateOnMikrotik({ gcashMode, perRouterMode, freeMode, mikrotikRouterList, routerId } = {}) {
  const rid = Number(routerId);
  const mode = normalizeGcashGenerateMode(perRouterMode || gcashMode);
  if (mode === "mikrotik") return true;
  if (String(freeMode || "").trim().toLowerCase() === "mikrotik") return true;
  const list = String(mikrotikRouterList || "")
    .split(",")
    .map((x) => Number(String(x).trim()))
    .filter(Boolean);
  return !!(rid && list.includes(rid));
}

/** KiTifi plan uptime → MikroTik limit-uptime (10 Hours → 10:00:00). */
export function kitifiUptimeToMikrotik(uptime) {
  const s = String(uptime || "").trim();
  const hm = s.match(/^(\d+)\s*[Hh](?:ours?)?(?:\s|$)/);
  if (hm) return String(Number(hm[1])) + ":00:00";
  const dm = s.match(/^(\d+)\s*[Dd](?:ays?)?(?:\s|$)/);
  if (dm) return dm[1] + "d";
  if (/^\d+:\d+:\d+$/.test(s)) return s;
  if (/^\d+[dhms]$/i.test(s)) return s;
  return "10:00:00";
}

/**
 * RouterOS profile names are case-sensitive. Plans say KITIFI but some sites
 * only have KiTiFi — pick the live name (exact, then case-insensitive).
 */
export function resolveHotspotUserProfile(wanted, liveProfiles = []) {
  const names = (liveProfiles || []).map((p) => String(p || "").trim()).filter(Boolean);
  const want = String(wanted || "KITIFI").trim() || "KITIFI";
  if (names.includes(want)) return want;
  const lower = want.toLowerCase();
  const ci = names.find((n) => n.toLowerCase() === lower);
  if (ci) return ci;
  const kitifi = names.find((n) => n.toLowerCase() === "kitifi");
  if (kitifi) return kitifi;
  return want;
}

export function hotspotUserAddWords({ code, profile, uptime, comment, liveProfiles }) {
  const name = String(code || "").trim();
  const prof = resolveHotspotUserProfile(profile || "KITIFI", liveProfiles);
  const limit = kitifiUptimeToMikrotik(uptime);
  const note = String(comment || ("JM GCash " + name)).trim();
  return [
    "/ip/hotspot/user/add",
    "=name=" + name,
    "=password=" + name,
    "=profile=" + prof,
    "=limit-uptime=" + limit,
    "=comment=" + note,
  ];
}

export const GENERATE_VOUCHER_OLD = `export async function kitifiMikrotikGenerateVoucher(conn, { plan, profile, uptime, routerId, prefix } = {}) {
  const p = plan || {};
  const rid = Number(routerId) || kitifiDefaultRouterId();
  const code = genVoucherCode(Number(kitifiGenNameLength(rid)) || 5, prefix || kitifiGenPrefix(rid) || "VC");
  const prof = String(profile || p.profile || Settings.get("kitifi_gen_profile_" + rid, "") || kitifiGenProfile(rid) || kitifiDefaultProfile() || "KITIFI").trim();
  const limit = kitifiUptimeToMikrotik(uptime || p.uptime || p.time || "10:00:00");
  await conn.talk([
    "/ip/hotspot/user/add",
    "=name=" + code,
    "=password=" + code,
    "=profile=" + prof,
    "=limit-uptime=" + limit,
    "=comment=JM GCash " + code,
  ]);`;

export const GENERATE_VOUCHER_NEW = `export async function kitifiMikrotikGenerateVoucher(conn, { plan, profile, uptime, routerId, prefix } = {}) {
  const p = plan || {};
  const rid = Number(routerId) || kitifiDefaultRouterId();
  const code = genVoucherCode(Number(kitifiGenNameLength(rid)) || 5, prefix || kitifiGenPrefix(rid) || "VC");
  const wanted = String(profile || p.profile || Settings.get("kitifi_gen_profile_" + rid, "") || kitifiGenProfile(rid) || kitifiDefaultProfile() || "KITIFI").trim();
  let liveProfiles = [];
  try {
    liveProfiles = ((await conn.print("/ip/hotspot/user/profile")) || []).map((x) => x.name).filter(Boolean);
  } catch {}
  const wantLower = wanted.toLowerCase();
  const prof =
    (liveProfiles.includes(wanted) && wanted) ||
    liveProfiles.find((n) => String(n).toLowerCase() === wantLower) ||
    liveProfiles.find((n) => String(n).toLowerCase() === "kitifi") ||
    wanted;
  const limit = kitifiUptimeToMikrotik(uptime || p.uptime || p.time || "10:00:00");
  await conn.talk([
    "/ip/hotspot/user/add",
    "=name=" + code,
    "=password=" + code,
    "=profile=" + prof,
    "=limit-uptime=" + limit,
    "=comment=JM GCash " + code,
  ]);`;

export function patchMikrotikGenerateResolveProfile(src) {
  const out = String(src || "");
  if (out.includes("liveProfiles.find((n) => String(n).toLowerCase() === \"kitifi\")")) {
    return { src: out, changed: false };
  }
  if (!out.includes(GENERATE_VOUCHER_OLD)) return { src: out, changed: false, missing: true };
  return { src: out.replace(GENERATE_VOUCHER_OLD, GENERATE_VOUCHER_NEW), changed: true };
}

export function hotspotLoginUrl(base, code) {
  const root = String(base || "http://10.0.0.1/login").replace(/\/$/, "");
  const u = encodeURIComponent(String(code || "").trim());
  return root + "?username=" + u + "&password=" + u;
}

/** Deleted KiTifi router rows → live replacements (operator re-added 2nd/3rd/1st). */
export const KITIFI_DELETED_ROUTER_ALIAS = {
  36: 57,
  46: 56,
  42: 52,
};

export function resolveKitifiBuyRouterId(id) {
  const n = Number(id);
  if (!n) return n;
  return KITIFI_DELETED_ROUTER_ALIAS[n] || n;
}

export function remapPortalSitesJson(json, aliases = KITIFI_DELETED_ROUTER_ALIAS) {
  let sites = {};
  try {
    sites = JSON.parse(json || "{}") || {};
  } catch {
    sites = {};
  }
  const out = { ...sites };
  for (const [from, to] of Object.entries(aliases)) {
    const src = sites[String(from)] || sites[from];
    if (!src) continue;
    const toKey = String(to);
    if (!out[toKey]) out[toKey] = { ...src, updated: new Date().toISOString() };
    out[String(from)] = { ...src, enabled: false, replaced_by: Number(to) };
  }
  return JSON.stringify(out);
}

export const GENERATE_PROFILE_OLD =
  'const prof = String(profile || p.profile || Settings.get("kitifi_gen_profile_" + rid, "") || kitifiGenProfile(rid) || "default").trim();';
export const GENERATE_PROFILE_NEW =
  'const prof = String(profile || p.profile || Settings.get("kitifi_gen_profile_" + rid, "") || kitifiGenProfile(rid) || kitifiDefaultProfile() || "KITIFI").trim();';

export function patchMikrotikGenerateProfile(src) {
  const out = String(src || "");
  if (out.includes(GENERATE_PROFILE_NEW)) return { src: out, changed: false };
  if (!out.includes(GENERATE_PROFILE_OLD)) return { src: out, changed: false, missing: true };
  return { src: out.replace(GENERATE_PROFILE_OLD, GENERATE_PROFILE_NEW), changed: true };
}

export function patchServerBuyRouterAlias(src) {
  let out = String(src || "");
  let changed = false;
  const impNeedle = 'from "./lib/kitifi-gcash-buy-pause.mjs";';
  const impExtra =
    impNeedle +
    '\nimport { resolveKitifiBuyRouterId } from "./lib/kitifi-mikrotik-direct-voucher.mjs";';
  if (!out.includes("resolveKitifiBuyRouterId")) {
    if (!out.includes(impNeedle)) return { src: out, changed: false, missing: "import" };
    out = out.replace(impNeedle, impExtra);
    changed = true;
  }
  const buyOld = "      const portalRouterId = kitifiPortalRouterId(b.router_id);";
  const buyNew = "      const portalRouterId = resolveKitifiBuyRouterId(kitifiPortalRouterId(b.router_id));";
  if (out.includes(buyOld)) {
    out = out.replace(buyOld, buyNew);
    changed = true;
  }
  const createOld = "          routerId: kitifiPortalRouterId(b.router_id), paymentIntentId: paymentRef,";
  const createNew = "          routerId: resolveKitifiBuyRouterId(kitifiPortalRouterId(b.router_id)), paymentIntentId: paymentRef,";
  if (out.includes(createOld)) {
    out = out.replace(createOld, createNew);
    changed = true;
  }
  const ridOld = "const rid = order.router_id || kitifiPortalRouterId();";
  const ridNew = "const rid = resolveKitifiBuyRouterId(order.router_id || kitifiPortalRouterId());";
  if (out.includes(ridOld)) {
    out = out.split(ridOld).join(ridNew);
    changed = true;
  }
  const ratesOld =
    '      const routerId = new URL(req.url, "http://localhost").searchParams.get("router_id") || "";\n' +
    '      const gcashOn = isGcashBuyEnabled(Settings.get(GCASH_BUY_ENABLED_KEY, "0"));';
  const ratesNew =
    '      const rawRid = new URL(req.url, "http://localhost").searchParams.get("router_id") || "";\n' +
    "      const routerId = String(resolveKitifiBuyRouterId(rawRid) || rawRid);\n" +
    '      const gcashOn = isGcashBuyEnabled(Settings.get(GCASH_BUY_ENABLED_KEY, "0"));';
  if (out.includes(ratesOld)) {
    out = out.replace(ratesOld, ratesNew);
    changed = true;
  }
  const cfgOld =
    '    if (pathname === "/api/kitifi/config" && req.method === "GET") {\n' +
    '      const routerId = new URL(req.url, "http://localhost").searchParams.get("router_id") || "";\n' +
    "      return send(res, 200, { ok: true, ...kitifiConfig(routerId || undefined) });";
  const cfgNew =
    '    if (pathname === "/api/kitifi/config" && req.method === "GET") {\n' +
    '      const rawCfg = new URL(req.url, "http://localhost").searchParams.get("router_id") || "";\n' +
    "      const routerId = rawCfg ? String(resolveKitifiBuyRouterId(rawCfg) || rawCfg) : \"\";\n" +
    "      return send(res, 200, { ok: true, ...kitifiConfig(routerId || undefined) });";
  if (out.includes(cfgOld)) {
    out = out.replace(cfgOld, cfgNew);
    changed = true;
  }
  return { src: out, changed };
}

export function patchKitifiApiFulfillAlias(src) {
  const old = "    const routerId = Number(order.router_id) || kitifiPortalRouterId();";
  const neu = "    const routerId = resolveKitifiBuyRouterId(Number(order.router_id) || kitifiPortalRouterId());";
  let out = String(src || "");
  if (out.includes(neu)) return { src: out, changed: false };
  if (!out.includes(old)) return { src: out, changed: false, missing: true };
  if (!out.includes("resolveKitifiBuyRouterId")) {
    const marker = 'import { isGcashBuyEnabled } from "./kitifi-gcash-buy-pause.mjs";';
    const extra =
      marker + '\nimport { resolveKitifiBuyRouterId } from "./kitifi-mikrotik-direct-voucher.mjs";';
    if (out.includes(marker)) out = out.replace(marker, extra);
    else {
      const db = 'import { Settings, Routers, Audit, KitifiOrders } from "./db.js";';
      if (out.includes(db)) {
        out = out.replace(
          db,
          db + '\nimport { resolveKitifiBuyRouterId } from "./kitifi-mikrotik-direct-voucher.mjs";',
        );
      }
    }
  }
  return { src: out.replace(old, neu), changed: true };
}
