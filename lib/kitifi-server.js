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
  kitifiAdminPass,
  kitifiSellerId,
  kitifiGenSellerId,
  kitifiGenSellerName,
  kitifiGenProfile,
  kitifiGenPrefix,
  kitifiGenNameLength,
  kitifiGenChar,
  kitifiUseCustomGenerate,
  planToCustomGenerateFields,
  kitifiForceNoExpiry,
  kitifiResolveLiveRateId,
  kitifiDiscoverSellerApiId,
} from "./kitifi-remote.js";
import { genVoucherCode } from "./hotspot-generator.js";

export function kitifiMikrotikOnlyRouter(routerId) {
  const rid = Number(routerId);
  if (!rid) return false;
  if (String(Settings.get("kitifi_free_mode_" + rid, "") || "").trim().toLowerCase() === "mikrotik") return true;
  const list = String(Settings.get("kitifi_free_mikrotik_routers", "51") || "")
    .split(",")
    .map((x) => Number(x.trim()))
    .filter(Boolean);
  return list.includes(rid);
}

export async function kitifiMikrotikGenerateVoucher(conn, { plan, profile, uptime, routerId, prefix } = {}) {
  const p = plan || {};
  const rid = Number(routerId) || kitifiDefaultRouterId();
  const code = genVoucherCode(Number(kitifiGenNameLength(rid)) || 5, prefix || kitifiGenPrefix(rid) || "VC");
  const prof = String(profile || p.profile || Settings.get("kitifi_gen_profile_" + rid, "") || kitifiGenProfile(rid) || "default").trim();
  const limit = kitifiUptimeToMikrotik(uptime || p.uptime || p.time || "10:00:00");
  await conn.talk([
    "/ip/hotspot/user/add",
    "=name=" + code,
    "=password=" + code,
    "=profile=" + prof,
    "=limit-uptime=" + limit,
    "=comment=JM GCash " + code,
  ]);
  return {
    code,
    codes: [code],
    profile: prof,
    uptime: uptime || p.uptime || p.time || "",
    seller: kitifiSellerName(),
    routerId: rid,
    generator: "mikrotik-direct",
  };
}

export function kitifiControllerUrl() {
  return kitifiAdminBase();
}

export function kitifiSellerName() {
  return Settings.get("kitifi_seller_name", "GCASH Online");
}

export function kitifiDefaultProfile() {
  return Settings.get("kitifi_default_profile", "KITIFI");
}

/** Mikrotik hotspot gateway — KiTifi hs_address / api.html (NOT the KiTifi admin PC). */
export const KITIFI_PORTAL_HS = "10.0.0.1";
/** KiTifi controller — client captive portal web UI. */
export const KITIFI_CONTROLLER = "10.0.0.10";
export const KITIFI_CAWAYAN_ROUTER_ID = 39;

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

/** Client portal URL on KiTifi PC (10.0.0.10) — autoconnect after GCash pay. */
export function kitifiPortalConnectUrl(voucherCode, routerId, mac) {
  const code = encodeURIComponent(String(voucherCode || "").trim());
  let url = "http://" + KITIFI_CONTROLLER + "/?voucher=" + code + "&autoconnect=1";
  const macAddr = String(mac || "").trim();
  if (macAddr) url += "&mac=" + encodeURIComponent(macAddr);
  return url;
}

export function kitifiConnectUrl(voucherCode, routerId, mac, ip) {
  const rid = Number(routerId);
  const code = String(voucherCode || "").trim();
  if (kitifiMikrotikOnlyRouter(rid) && code) {
    const base = kitifiHotspotLoginBase(rid).replace(/\/$/, "");
    const u = encodeURIComponent(code);
    return base + "?username=" + u + "&password=" + u;
  }
  const clientIp = String(ip || "").trim();
  if (clientIp && rid === 37) return kitifiGatewayLoginUrl(voucherCode, clientIp, mac);
  return kitifiPortalConnectUrl(voucherCode, routerId, mac);
}

async function kitifiClientIpForMac(conn, macAddr) {
  const hosts = await conn.print("/ip/hotspot/host");
  const host = (hosts || []).find((h) => String(h["mac-address"] || "").toUpperCase() === macAddr);
  if (host?.address) return String(host.address);
  const leases = await conn.print("/ip/dhcp-server/lease");
  const lease = (leases || []).find((l) => String(l["mac-address"] || "").toUpperCase() === macAddr);
  if (lease?.address) return String(lease.address);
  return "";
}

export function kitifiGatewayFromIp(ip) {
  const m = String(ip || "").trim().match(/^(\d+\.\d+\.\d+)\.\d+$/);
  return m ? m[1] + ".1" : "";
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

async function kitifiEnsureMikrotikHotspotUser(conn, { code, profile, uptime } = {}) {
  const name = String(code || "").trim();
  if (!name) return { ok: false, reason: "missing voucher code" };
  const prof = String(profile || kitifiDefaultProfile() || "KITIFI").trim();
  const limit = kitifiUptimeToMikrotik(uptime);
  const users = await conn.print("/ip/hotspot/user");
  const hit = (users || []).find((u) => String(u.name || "").toUpperCase() === name.toUpperCase());
  if (hit) return { ok: true, existed: true, limit: hit["limit-uptime"] || limit };
  await conn.talk([
    "/ip/hotspot/user/add",
    "=name=" + name,
    "=password=" + name,
    "=profile=" + prof,
    "=limit-uptime=" + limit,
    "=comment=JM GCash " + name,
  ]);
  return { ok: true, created: true, limit };
}

async function kitifiClearKitifiSetupBypass(conn, macAddr) {
  const binds = await conn.print("/ip/hotspot/ip-binding");
  for (const b of binds || []) {
    if (String(b["mac-address"] || "").toUpperCase() !== macAddr) continue;
    if (String(b.comment || "").includes("KiTifi-Setup") || b.type === "bypassed") {
      try {
        await conn.talk(["/ip/hotspot/ip-binding/remove", "=.id=" + b[".id"]]);
      } catch {}
    }
  }
}

/** MikroTik gateway login URL — works on multi-VLAN 4rth when KiTifi portal loader is stuck. */
export function kitifiGatewayLoginUrl(voucherCode, clientIp, mac) {
  const code = String(voucherCode || "").trim();
  const gw = kitifiGatewayFromIp(clientIp);
  if (!gw || !code) return kitifiPortalConnectUrl(voucherCode, null, mac);
  const u = encodeURIComponent(code);
  return "http://" + gw + "/login?username=" + u + "&password=" + u;
}

/** Apply GCash voucher on MikroTik (fallback when KiTifi voucher_handler returns User not found). */
export async function kitifiMikrotikVoucherConnect(conn, { mac, voucher, routerId, ip, uptime, profile } = {}) {
  if (Number(routerId) === KITIFI_CAWAYAN_ROUTER_ID) return { ok: false, skipped: true, reason: "cawayan excluded" };
  const code = String(voucher || "").trim();
  const macAddr = String(mac || "").trim().toUpperCase().replace(/-/g, ":");
  if (!code || !macAddr || macAddr.length < 11) return { ok: false, reason: "missing mac or voucher" };

  const clientIp = String(ip || "").trim() || await kitifiClientIpForMac(conn, macAddr);
  if (!clientIp) return { ok: false, reason: "client not on WiFi (no hotspot host)" };

  try {
    await kitifiEnsureMikrotikHotspotUser(conn, { code, profile, uptime });
    await kitifiClearKitifiSetupBypass(conn, macAddr);
    await conn.talk([
      "/ip/hotspot/active/login",
      "=user=" + code,
      "=password=" + code,
      "=ip=" + clientIp,
      "=mac-address=" + macAddr,
    ]);
    return {
      ok: true,
      ip: clientIp,
      mac: macAddr,
      gateway: kitifiGatewayFromIp(clientIp),
      connect_url: kitifiGatewayLoginUrl(code, clientIp, macAddr),
      via: "mikrotik-active-login",
    };
  } catch (e) {
    const msg = String(e.message || "");
    return {
      ok: false,
      reason: msg.split(",")[0],
      ip: clientIp,
      mac: macAddr,
      gateway: kitifiGatewayFromIp(clientIp),
      connect_url: kitifiGatewayLoginUrl(code, clientIp, macAddr),
      via: "gateway-login-url",
    };
  }
}

/** Best connect URL after GCash pay (gateway login on 4rth multi-VLAN). */
export async function kitifiOrderConnectUrl(conn, { voucher, mac, routerId, uptime, profile } = {}) {
  const code = String(voucher || "").trim();
  const rid = routerId != null && routerId !== "" ? Number(routerId) : kitifiPortalRouterId();
  const macAddr = String(mac || "").trim();
  if (!code) return "";
  if (!macAddr) return kitifiConnectUrl(code, rid);
  const ip = await kitifiClientIpForMac(conn, String(macAddr).toUpperCase().replace(/-/g, ":"));
  if (ip && rid === 37) return kitifiGatewayLoginUrl(code, ip, macAddr);
  return kitifiConnectUrl(code, rid, macAddr, ip);
}

/** Redeem GCash voucher via KiTifi portal API (same as client Submit button). */
export async function kitifiRedeemVoucher(conn, { mac, voucher, routerId, ip } = {}) {
  if (Number(routerId) === KITIFI_CAWAYAN_ROUTER_ID) return { ok: false, skipped: true, reason: "cawayan excluded" };
  const code = String(voucher || "").trim();
  const macAddr = String(mac || "").trim().toUpperCase().replace(/-/g, ":");
  if (!code || !macAddr || macAddr.length < 11) return { ok: false, reason: "missing mac or voucher" };

  const clientIp = String(ip || "").trim() || await kitifiClientIpForMac(conn, macAddr);
  if (!clientIp) return { ok: false, reason: "client not on WiFi (no hotspot host)" };

  const payload = JSON.stringify({ mac: macAddr, ip: clientIp, user: "", code, type: "voucher" });
  const r = await conn.talk([
    "/tool/fetch",
    "=url=http://" + KITIFI_CONTROLLER + "/admin/api/portal/voucher_handler.php",
    "=mode=http",
    "=http-method=post",
    "=http-data=" + payload,
    "=http-header-field=Content-Type: application/json",
    "=output=user",
    "=check-certificate=no",
  ]);
  const text = (r || []).map((x) => x.data || "").join("");
  const i = text.indexOf("{");
  if (i < 0) return { ok: false, reason: text.slice(0, 120) || "empty response" };
  try {
    const j = JSON.parse(text.slice(i));
    if (j.status === true || j.status === "true" || j.status === 1) {
      return { ok: true, ip: clientIp, mac: macAddr, message: j.message || "" };
    }
    return { ok: false, reason: j.message || text.slice(0, 120) };
  } catch {
    return { ok: false, reason: text.slice(0, 120) };
  }
}

/** Authorize hotspot client by MAC after GCash voucher (works even if browser closed). */
export async function kitifiHotspotLoginByMac(conn, { mac, voucher, routerId } = {}) {
  if (Number(routerId) === KITIFI_CAWAYAN_ROUTER_ID) return { ok: false, skipped: true, reason: "cawayan excluded" };
  const code = String(voucher || "").trim();
  const macAddr = String(mac || "").trim().toUpperCase().replace(/-/g, ":");
  if (!code || !macAddr || macAddr.length < 11) return { ok: false, reason: "missing mac or voucher" };

  const ip = await kitifiClientIpForMac(conn, macAddr);
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
    seller_id: overrides.seller_id || kitifiGenSellerId(overrides.routerId),
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
  const rid = routerId != null && routerId !== "" ? Number(routerId) : kitifiDefaultRouterId();
  if (kitifiMikrotikOnlyRouter(rid)) {
    return kitifiMikrotikGenerateVoucher(conn, {
      plan: p,
      profile: profile || p.profile,
      uptime: uptime || p.uptime || p.time,
      routerId: rid,
      prefix,
    });
  }
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

/** Live rates for Direct KiTifi generator (uses gen seller, not GCash seller). */
export async function kitifiFetchRemoteRates(conn, routerId) {
  const rid = routerId != null && routerId !== "" ? routerId : undefined;
  const ck = await kitifiLogin(conn, rid);
  const genName = kitifiGenSellerName(rid);
  let sellerId = kitifiGenSellerId(rid);
  if (!Settings.get("kitifi_gen_seller_id_" + String(rid || ""), "")) {
    sellerId = await kitifiDiscoverSellerApiId(conn, ck, {
      name: genName,
      routerId: rid,
      fallbackNames: ["VOUCHER", "VOUCHER-for-FREE", "GCASH"],
    });
  }
  const rates = await kitifiRemoteRates(conn, ck, {
    routerId: rid,
    seller_id: sellerId,
    seller_name: genName,
  });
  return { sellerId, rates, sellerName: genName };
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
    seller_name: kitifiGenSellerName(rid),
    seller_id: kitifiGenSellerId(rid),
    gcash_seller_id: kitifiSellerId(rid),
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
    rates: kitifiPlans(rid),
    has_admin_pass: !!kitifiAdminPass(rid),
    admin_user: Settings.get("kitifi_admin_user", "admin"),
    mode: "remote-admin",
  };
}
