// Bridge jmwifi.pro ↔ KiTifi controller (10.0.0.10) via MikroTik /tool/fetch.
// Admin + GCash voucher creation calls KiTifi's real Voucher Generator API
// (POST api/pages/home.php action=generateVoucher) — same as the UI Generate button.
import { Settings } from "./db.js";
import { kitifiDefaultRouterId, kitifiPortalRouterId, kitifiPortalSites, kitifiPlans, kitifiPlanById } from "./kitifi-vouchers.js";
import {
  kitifiRemoteGenerate,
  kitifiRemoteRates,
  kitifiRemoteListCodes,
  kitifiLogin,
  resolveKitifiRateId,
  kitifiAdminBase,
  kitifiSellerId,
  kitifiGenProfile,
  kitifiGenPrefix,
  kitifiGenNameLength,
  kitifiGenChar,
  kitifiUseCustomGenerate,
  planToCustomGenerateFields,
  kitifiForceNoExpiry,
  kitifiResolveLiveRateId,
  KITIFI_CAWAYAN_ROUTER_ID,
} from "./kitifi-remote.js";

export function kitifiControllerUrl(routerId) {
  return kitifiAdminBase(routerId);
}

export function kitifiSellerName() {
  return Settings.get("kitifi_seller_name", "GCASH Online");
}

export function kitifiDefaultProfile() {
  return Settings.get("kitifi_default_profile", "KITIFI");
}

/** Mikrotik hotspot gateway — captive portal lives here (NOT 10.0.0.10 admin). */
export const KITIFI_PORTAL_HS = "10.0.0.1";
export { KITIFI_CAWAYAN_ROUTER_ID } from "./kitifi-remote.js";

export function kitifiPortalHost(routerId) {
  if (Number(routerId) === KITIFI_CAWAYAN_ROUTER_ID) return "11.0.0.1";
  return KITIFI_PORTAL_HS;
}

export function kitifiHotspotLoginBase(routerId) {
  if (routerId != null && routerId !== "") {
    const per = Settings.get("kitifi_hotspot_login_" + String(routerId), "");
    if (per) return String(per).replace(/\/$/, "");
  }
  const global = Settings.get("kitifi_hotspot_login", "");
  if (global) return String(global).replace(/\/$/, "");
  return "http://" + kitifiPortalHost(routerId) + "/login";
}

export function kitifiConnectUrl(voucherCode, routerId) {
  const base = kitifiHotspotLoginBase(routerId);
  const code = encodeURIComponent(String(voucherCode || "").trim());
  return base + (base.includes("?") ? "&" : "/?") + "username=" + code + "&autoconnect=1";
}

/** Authorize hotspot client by MAC after GCash voucher (works even if browser closed). */
export async function kitifiHotspotLoginByMac(conn, { mac, voucher, routerId } = {}) {
  if (Number(routerId) === KITIFI_CAWAYAN_ROUTER_ID) return { ok: false, skipped: true, reason: "cawayan excluded" };
  const code = String(voucher || "").trim();
  const macAddr = String(mac || "").trim().toUpperCase().replace(/-/g, ":");
  if (!code || !macAddr || macAddr.length < 11) return { ok: false, reason: "missing mac or voucher" };

  let ip = "";
  const hosts = await conn.print("/ip/hotspot/host");
  const host = (hosts || []).find((h) => String(h["mac-address"] || "").toUpperCase() === macAddr);
  if (host?.address) ip = String(host.address);

  if (!ip) {
    const leases = await conn.print("/ip/dhcp-server/lease");
    const lease = (leases || []).find((l) => String(l["mac-address"] || "").toUpperCase() === macAddr);
    if (lease?.address) ip = String(lease.address);
  }

  if (!ip) return { ok: false, reason: "client not on hotspot host list (offline or not on WiFi)" };

  const args = [
    "/ip/hotspot/active/login",
    "=user=" + code,
    "=password=" + code,
    "=ip=" + ip,
    "=mac-address=" + macAddr,
  ];

  try {
    await conn.talk(args);
    return { ok: true, ip, mac: macAddr };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

/** Plans for GCash buy (₱20+). */
export function kitifiRatesForPortal(routerId) {
  return kitifiPlans(routerId).filter((p) => Number(p.price) >= 20);
}

/** KiTifi generator rates for GCash buy UI (₱20+ only). */
export function kitifiGeneratorRatesDisplay(routerId, opts = {}) {
  const gcashOnly = opts.gcashOnly !== false;
  const plans = gcashOnly ? kitifiRatesForPortal(routerId) : kitifiPlans(routerId);
  return plans.map((p) => ({
    id: p.id,
    price: Number(p.price) || 0,
    name: p.name || "",
    time: p.time || p.uptime || p.name || "",
    expiry: p.expiry || "N/A",
    pause_limit: p.pause_limit != null ? String(p.pause_limit) : "0",
    amount_display: p.amount_display || "",
    label: p.label || "",
    kitifi_rate_id: p.kitifi_rate_id || p.r_id || "",
    gcash_ok: Number(p.price) >= 20,
  }));
}

export async function kitifiRecoverBatchCode(conn, batch) {
  if (!batch) return "";
  const codes = await kitifiRemoteListCodes(conn, { batch, expect: 1 });
  return String(codes[0] || "").trim();
}

/**
 * @param {object} conn - RouterOS connection to the site that can reach 10.0.0.10
 */
/** Shared generate payload for GCash + admin batch (VOUCHER station, not SULUDAN rates). */
export function kitifiBuildGenerateOpts(plan, overrides = {}) {
  const rateId = resolveKitifiRateId({
    plan,
    r_id: overrides.r_id || overrides.rate_id,
    amount: overrides.price || plan?.price,
  });
  const base = {
    qty: overrides.qty ?? overrides.count ?? 1,
    profile: overrides.profile || plan?.profile || kitifiGenProfile() || kitifiDefaultProfile(),
    prefix: overrides.prefix != null ? overrides.prefix : kitifiGenPrefix(),
    name_length: overrides.name_length || overrides.length || kitifiGenNameLength(),
    char: overrides.char || kitifiGenChar(),
    seller_id: overrides.seller_id || kitifiSellerId(),
  };
  if (overrides.type === "custom" || (plan && kitifiUseCustomGenerate(plan, rateId) && overrides.type !== "default")) {
    return kitifiForceNoExpiry({ ...base, ...planToCustomGenerateFields(plan) });
  }
  return kitifiForceNoExpiry({
    ...base,
    type: overrides.type || "default",
    r_id: rateId,
    amount: String(overrides.amount ?? overrides.price ?? "0"),
    day: String(overrides.day ?? "0"),
    hour: String(overrides.hour ?? "0"),
    min: String(overrides.min ?? "0"),
    eday: "0",
    ehour: "0",
    emin: "0",
    points: String(overrides.points ?? "0"),
    pause_limit: String(overrides.pause_limit ?? "0"),
  });
}

export async function kitifiGenerateVoucher(conn, { planId, plan, profile, uptime, seller, r_id, prefix, name_length, char, seller_id, routerId } = {}) {
  const p = plan || kitifiPlanById(planId, routerId) || {};
  const sid = seller_id || kitifiSellerId(routerId);
  let liveRId = "";
  if (Number(p.price) >= 20) {
    try {
      liveRId = await kitifiResolveLiveRateId(conn, { price: p.price, seller_id: sid, routerId });
    } catch {}
  }
  const genOpts = kitifiBuildGenerateOpts(p, {
    qty: 1,
    profile,
    prefix,
    name_length,
    char,
    seller_id: sid,
    r_id: liveRId || r_id,
    type: liveRId ? "default" : undefined,
  });
  genOpts.qty = 1;
  if (liveRId) {
    genOpts.type = "default";
    genOpts.r_id = liveRId;
  }
  genOpts.routerId = routerId;
  const result = await kitifiRemoteGenerate(conn, genOpts);
  const code = String((result.codes && result.codes[0]) || "").trim();
  if (!code) throw new Error("KiTifi generated batch " + result.batch + " but returned no voucher code.");
  // Never return / keep extra codes from a bad scrape — paid path is 1 voucher only.
  return {
    code,
    batch: result.batch,
    codes: [code],
    profile: result.profile,
    uptime: uptime || p.uptime || "",
    seller: seller || kitifiSellerName(),
    routerId: routerId || kitifiDefaultRouterId(),
    generator: "kitifi-admin-remote",
    r_id: genOpts.r_id || resolveKitifiRateId({ plan: p, r_id, amount: p.price }),
    generate_type: genOpts.type || "default",
  };
}

/**
 * Batch generate via KiTifi admin (one Generate click with qty=N).
 */
export async function kitifiGenerateBatch(conn, opts = {}) {
  const result = await kitifiRemoteGenerate(conn, kitifiForceNoExpiry(opts));
  return result;
}

export async function kitifiFetchRemoteRates(conn) {
  return kitifiRemoteRates(conn);
}

export async function kitifiTestLogin(conn, routerId) {
  const cookie = await kitifiLogin(conn, routerId);
  return { ok: true, cookie: cookie ? "session" : "" };
}

/** Save KiTifi Wifi Rates from admin (copy from KiTifi dashboard → Wifi Rates). */
export function kitifiSaveRates(rates, routerId) {
  if (!Array.isArray(rates) || !rates.length) throw new Error("Rates array required");
  if (routerId != null && routerId !== "") {
    Settings.set("kitifi_plans_" + String(routerId), JSON.stringify(rates));
    return rates;
  }
  Settings.set("kitifi_plans", JSON.stringify(rates));
  return rates;
}

export function kitifiConfig(routerId) {
  const rid = routerId != null && routerId !== "" ? Number(routerId) : kitifiPortalRouterId();
  return {
    controller_url: kitifiAdminBase(rid),
    seller_name: kitifiSellerName(),
    seller_id: kitifiSellerId(rid),
    default_profile: kitifiDefaultProfile(),
    gen_profile: kitifiGenProfile(),
    gen_prefix: kitifiGenPrefix(),
    gen_char: kitifiGenChar(),
    gen_name_length: kitifiGenNameLength(),
    hotspot_login: kitifiHotspotLoginBase(rid),
    portal_host: kitifiPortalHost(rid),
    router_id: rid,
    portal_router_id: kitifiPortalRouterId(),
    portal_sites: kitifiPortalSites(),
    rates: kitifiRatesForPortal(),
    has_admin_pass: !!Settings.get("kitifi_admin_pass", ""),
    admin_user: Settings.get("kitifi_admin_user", "admin"),
    mode: "remote-admin",
  };
}
