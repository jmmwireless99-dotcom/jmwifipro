/**
 * Panisijan (router 51): free CLAIM + GCash BUY both create MikroTik
 * /ip/hotspot/user vouchers (same model as other KiTifi MikroTik sites).
 *
 * Buy profile: default (Panisijan has no KITIFI profile)
 * Free claim profile: FREE
 */
export const PANISIJAN_ROUTER_ID = 51;
export const PANISIJAN_BUY_PROFILE = "default";
export const PANISIJAN_FREE_PROFILE = "FREE";
export const PANISIJAN_FREE_MODE_KEY = "kitifi_free_mode_" + PANISIJAN_ROUTER_ID;
export const PANISIJAN_GEN_PROFILE_KEY = "kitifi_gen_profile_" + PANISIJAN_ROUTER_ID;
export const PANISIJAN_DEFAULT_PROFILE_KEY = "kitifi_default_profile_" + PANISIJAN_ROUTER_ID;
export const PANISIJAN_FREE_PROFILE_KEY = "kitifi_free_profile_" + PANISIJAN_ROUTER_ID;
export const PANISIJAN_FREE_ENABLED_KEY = "kitifi_free_enabled_" + PANISIJAN_ROUTER_ID;

export function panisijanMikrotikSettings() {
  return {
    [PANISIJAN_FREE_MODE_KEY]: "mikrotik",
    [PANISIJAN_FREE_ENABLED_KEY]: "1",
    [PANISIJAN_FREE_PROFILE_KEY]: PANISIJAN_FREE_PROFILE,
    [PANISIJAN_GEN_PROFILE_KEY]: PANISIJAN_BUY_PROFILE,
    [PANISIJAN_DEFAULT_PROFILE_KEY]: PANISIJAN_BUY_PROFILE,
    kitifi_gcash_generate: "mikrotik",
    ["kitifi_gcash_generate_" + PANISIJAN_ROUTER_ID]: "mikrotik",
    kitifi_free_mikrotik_routers: String(PANISIJAN_ROUTER_ID),
    kitifi_hotspot_login_51: "http://10.0.0.1/login",
  };
}

/** Prefer per-router kitifi_gen_profile_<id> over global KITIFI. */
export function patchKitifiGenProfilePerRouter(src) {
  const out = String(src || "");
  const old =
    "export function kitifiGenProfile() {\n" +
    '  return Settings.get("kitifi_gen_profile", "KITIFI");\n' +
    "}";
  const neu =
    "export function kitifiGenProfile(routerId) {\n" +
    "  if (routerId != null && routerId !== \"\") {\n" +
    '    const per = Settings.get("kitifi_gen_profile_" + String(routerId), "");\n' +
    "    if (per) return per;\n" +
    "  }\n" +
    '  return Settings.get("kitifi_gen_profile", "KITIFI");\n' +
    "}";
  if (out.includes('kitifi_gen_profile_" + String(routerId)')) {
    return { src: out, changed: false };
  }
  if (!out.includes(old)) return { src: out, changed: false, missing: ["kitifiGenProfile"] };
  return { src: out.replace(old, neu), changed: true };
}

export function patchKitifiDefaultProfilePerRouter(src) {
  const out = String(src || "");
  const old =
    "export function kitifiDefaultProfile() {\n" +
    '  return Settings.get("kitifi_default_profile", "KITIFI");\n' +
    "}";
  const neu =
    "export function kitifiDefaultProfile(routerId) {\n" +
    "  if (routerId != null && routerId !== \"\") {\n" +
    '    const per = Settings.get("kitifi_default_profile_" + String(routerId), "");\n' +
    "    if (per) return per;\n" +
    "  }\n" +
    '  return Settings.get("kitifi_default_profile", "KITIFI");\n' +
    "}";
  if (out.includes('kitifi_default_profile_" + String(routerId)')) {
    return { src: out, changed: false };
  }
  if (!out.includes(old)) return { src: out, changed: false, missing: ["kitifiDefaultProfile"] };
  return { src: out.replace(old, neu), changed: true };
}

export function patchKitifiConfigPerRouterProfiles(src) {
  const out = String(src || "");
  const old =
    "    default_profile: kitifiDefaultProfile(),\n" +
    "    gen_profile: kitifiGenProfile(),\n";
  const neu =
    "    default_profile: kitifiDefaultProfile(rid),\n" +
    "    gen_profile: kitifiGenProfile(rid),\n";
  if (out.includes("kitifiDefaultProfile(rid)") && out.includes("kitifiGenProfile(rid)")) {
    return { src: out, changed: false };
  }
  if (!out.includes(old)) return { src: out, changed: false, missing: ["kitifiConfig profiles"] };
  return { src: out.replace(old, neu), changed: true };
}

/** generator-rates should expose per-router buy profile (Panisijan=default). */
export function patchServerGeneratorRatesProfile(src) {
  const out = String(src || "");
  const old = '        profile: Settings.get("kitifi_gen_profile", "KITIFI"),\n';
  const neu =
    '        profile: Settings.get("kitifi_gen_profile_" + (routerId || ""), "") || Settings.get("kitifi_gen_profile", "KITIFI"),\n';
  if (out.includes('kitifi_gen_profile_" + (routerId || "")')) {
    return { src: out, changed: false };
  }
  if (!out.includes(old)) return { src: out, changed: false, missing: ["generator-rates profile"] };
  return { src: out.replace(old, neu), changed: true };
}

/** Buy order fallback must not force KITIFI onto Panisijan. */
export function patchServerBuyOrderProfileFallback(src) {
  const out = String(src || "");
  const old = 'profile: plan.profile || "KITIFI"';
  const neu =
    'profile: plan.profile || Settings.get("kitifi_gen_profile_" + String(portalRouterId || ""), "") || Settings.get("kitifi_gen_profile", "KITIFI")';
  if (out.includes('kitifi_gen_profile_" + String(portalRouterId')) {
    return { src: out, changed: false };
  }
  if (!out.includes(old)) return { src: out, changed: false, missing: ["buy order profile fallback"] };
  return { src: out.replace(old, neu), changed: true };
}

export function ensurePortalSitePanisijan(json) {
  let sites = {};
  try {
    sites = JSON.parse(json || "{}") || {};
  } catch {
    sites = {};
  }
  const cur = sites[String(PANISIJAN_ROUTER_ID)] || {};
  sites[String(PANISIJAN_ROUTER_ID)] = {
    ...cur,
    name: cur.name || "PANISIJAN-CCTV",
    label: cur.label || "Panisijan",
    brand: cur.brand || "Panisijan",
    enabled: true,
    updated: new Date().toISOString(),
  };
  return JSON.stringify(sites);
}
