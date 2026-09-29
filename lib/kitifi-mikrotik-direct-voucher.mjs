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

export function hotspotUserAddWords({ code, profile, uptime, comment }) {
  const name = String(code || "").trim();
  const prof = String(profile || "KITIFI").trim() || "KITIFI";
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

export function hotspotLoginUrl(base, code) {
  const root = String(base || "http://10.0.0.1/login").replace(/\/$/, "");
  const u = encodeURIComponent(String(code || "").trim());
  return root + "?username=" + u + "&password=" + u;
}
