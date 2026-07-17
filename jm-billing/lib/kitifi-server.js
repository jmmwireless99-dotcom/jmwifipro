// Bridge jmwifi.pro ↔ KiTifi controller (10.0.0.10) via MikroTik API.
// KiTifi has no public REST API — it pushes vouchers to the same router profiles/rates.
// jmwifi.pro mirrors KiTifi Voucher Generator: VOUCHER profile + limit-uptime from Wifi Rates.
import { Settings } from "./db.js";
import { kitifiDefaultRouterId, kitifiPlans, kitifiPlanById } from "./kitifi-vouchers.js";
export { kitifiDefaultRouterId, kitifiPlans, kitifiPlanById };

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function kitifiControllerUrl() {
  return Settings.get("kitifi_controller_url", "http://10.0.0.10/admin");
}

export function kitifiSellerName() {
  return Settings.get("kitifi_seller_name", "GCASH Online");
}

export function kitifiDefaultProfile() {
  return Settings.get("kitifi_default_profile", "VOUCHER");
}

export function kitifiHotspotLoginBase() {
  return Settings.get("kitifi_hotspot_login", "http://10.30.32.1/login").replace(/\/$/, "");
}

export function kitifiConnectUrl(voucherCode) {
  return kitifiHotspotLoginBase() + "?username=" + encodeURIComponent(String(voucherCode || "").trim());
}

/** Plans = KiTifi Wifi Rates (stored in Settings → kitifi_plans JSON). */
export function kitifiRatesForPortal() {
  return kitifiPlans().filter((p) => Number(p.price) >= 20);
}

function genCode(len, prefix = "") {
  let s = String(prefix || "");
  const n = Math.min(Math.max(Number(len) || 8, 4), 16);
  for (let i = 0; i < n; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return s;
}

/**
 * KiTifi Voucher Generator command — jmwifi.pro issues the same RouterOS API call
 * KiTifi uses internally (hotspot user + VOUCHER profile + limit-uptime from Wifi Rates).
 * KiTifi has no public HTTP API; this is the integration bridge.
 * @param {object} conn - RouterOS connection
 * @param {{ planId, plan?, profile?, uptime?, seller?, code?, password?, length?, prefix? }} opts
 */
export async function kitifiGenerateVoucher(conn, { planId, plan, profile, uptime, seller, code, password = "", length = 8, prefix = "" } = {}) {
  const p = plan || kitifiPlanById(planId) || {};
  const prof = profile || p.profile || kitifiDefaultProfile();
  const limit = uptime || p.uptime || "1d";
  const name = code || genCode(length, prefix);
  const cmd = { name, password: password || "", profile: prof, limitUptime: limit };
  await conn.createHotspotUser(cmd);
  return {
    code: name,
    profile: prof,
    uptime: limit,
    seller: seller || kitifiSellerName(),
    routerId: kitifiDefaultRouterId(),
    generator: "kitifi",
    command: "createHotspotUser",
    params: cmd,
  };
}

/** Bulk KiTifi vouchers for the admin Hotspot Generator page. */
export async function kitifiGenerateVouchers(conn, {
  count = 10,
  planId = "",
  profile = "",
  uptime = "",
  length = 8,
  prefix = "",
  userOnly = true,
  seller = "",
} = {}) {
  const plan = kitifiPlanById(planId) || null;
  const n = Math.min(Math.max(Number(count) || 10, 1), 500);
  const made = [];
  const errors = [];
  let lastProfile = profile || plan?.profile || kitifiDefaultProfile();
  let lastUptime = uptime || plan?.uptime || "1h";
  for (let i = 0; i < n; i++) {
    try {
      const code = genCode(length, prefix);
      const row = await kitifiGenerateVoucher(conn, {
        planId, plan, profile: lastProfile, uptime: lastUptime,
        seller, code, password: userOnly ? "" : code,
      });
      made.push(row.code);
      lastProfile = row.profile;
      lastUptime = row.uptime;
    } catch (e) {
      errors.push(e.message || String(e));
    }
  }
  return {
    created: made,
    count: made.length,
    profile: lastProfile,
    uptime: lastUptime,
    price: plan?.price != null ? `₱${plan.price}` : "",
    userOnly: userOnly !== false,
    errors,
    generator: "kitifi",
    seller: seller || kitifiSellerName(),
    planId: planId || plan?.id || "",
    controller: kitifiControllerUrl(),
  };
}

/** Save KiTifi Wifi Rates from admin (copy from KiTifi dashboard → Wifi Rates). */
export function kitifiSaveRates(rates) {
  if (!Array.isArray(rates) || !rates.length) throw new Error("Rates array required");
  Settings.set("kitifi_plans", JSON.stringify(rates));
  return rates;
}

export function kitifiConfig() {
  return {
    controller_url: kitifiControllerUrl(),
    seller_name: kitifiSellerName(),
    default_profile: kitifiDefaultProfile(),
    hotspot_login: kitifiHotspotLoginBase(),
    router_id: kitifiDefaultRouterId(),
    rates: kitifiRatesForPortal(),
  };
}
