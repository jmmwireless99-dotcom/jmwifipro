/**
 * Hotspot walled-garden hosts for GCash / PayMongo / Maya — buy voucher without mobile data.
 * Used by PANISIJAN deploy and jmwifi.pro /api/hotspot/walled-garden script generator.
 */

/** HTTP walled-garden dst-host entries (MikroTik matches Host header). */
export const PAYMENT_WALLED_GARDEN_HOSTS = [
  // JM billing portal + buy voucher + API poll
  "jmwifi.pro",
  "www.jmwifi.pro",
  // PayMongo QR / checkout / webhooks
  "paymongo.com",
  "api.paymongo.com",
  "checkout.paymongo.com",
  "assets.paymongo.com",
  "hooks.paymongo.com",
  "qrcode.paymongo.com",
  // GCash / MYNT (Globe/Ant Financial)
  "gcash.com",
  "payments.gcash.com",
  "gcash-api.pulseid.com",
  "api.mynt.xyz",
  "login.mynt.xyz",
  "mss.paas.mynt.xyz",
  "mdap.paas.mynt.xyz",
  "mgs-gw.paas.mynt.xyz",
  "customer-segment-api.mynt.xyz",
  "irisk-sea.alipay.com",
  "gw.alipayobjects.com",
  "beacons.gcp.gvt2.com",
  // Maya (QR upload from gallery)
  "maya.ph",
  "payments.maya.ph",
  "api.paymaya.com",
  "assets.paymaya.com",
  // Shared checkout/CDN
  "xendit.co",
  "checkout.xendit.co",
  "checkout-ui-gateway.xendit.co",
  "assets.xendit.co",
  "ewallet-service-live.xendit.co",
  "cdnjs.cloudflare.com",
  "fonts.googleapis.com",
  "fonts.gstatic.com",
  "cloudflare.com",
  // Captive portal / app probes (phone shows login instead of “no internet”)
  "connectivitycheck.gstatic.com",
  "connectivitycheck.android.com",
  "clients3.google.com",
  "captive.apple.com",
  "www.msftconnecttest.com",
  "detectportal.firefox.com",
];

/** Known payment CDN IPs (HTTPS — add to walled-garden/ip). Refresh via deploy if needed. */
export const PAYMENT_WALLED_GARDEN_STATIC_IPS = [
  "187.77.145.131", // jmwifi.pro VPS fallback
  "8.8.8.8",
  "8.8.4.4",
  "1.1.1.1",
  "1.0.0.1",
  // PayMongo / AWS ap-southeast-1 (common)
  "18.138.78.193",
  "3.0.107.195",
  "3.1.78.74",
  // GCash / Akamai / Incapsula (from PH hotspot payment lists)
  "45.60.160.35",
  "110.75.232.97",
  "110.75.232.98",
  "110.75.232.99",
  "110.75.232.100",
  "104.67.185.229",
];

const JM = "JM ";

/** RouterOS CLI lines for copy-paste or cloud-hotspot script. */
export function hotspotWalledGardenCommands(opts = {}) {
  const portalHost = String(opts.portalHost || "jmwifi.pro").trim();
  const portalIp = String(opts.portalIp || "187.77.145.131").trim();
  const lines = [];
  const hosts = new Set(PAYMENT_WALLED_GARDEN_HOSTS);
  if (portalHost) {
    hosts.add(portalHost);
    if (!portalHost.startsWith("www.")) hosts.add("www." + portalHost);
  }
  for (const h of hosts) {
    lines.push(`/ip hotspot walled-garden add dst-host=${h} action=allow comment="${JM}GCash PayMongo"`);
  }
  const ips = new Set(PAYMENT_WALLED_GARDEN_STATIC_IPS);
  if (portalIp) ips.add(portalIp);
  for (const ip of ips) {
    if (ip.includes(":")) continue;
    if (ip.endsWith(".0") || ip.endsWith(".255")) continue;
    const note = ip === portalIp ? "portal HTTPS" : "GCash PayMongo HTTPS";
    lines.push(`/ip hotspot walled-garden ip add dst-address=${ip} action=accept comment="${JM}${note}"`);
  }
  lines.push(`/ip hotspot walled-garden ip add dst-address=${portalIp} protocol=udp dst-port=53 action=accept comment="${JM}DNS udp"`);
  return lines.join("\n");
}

function hostKey(entry) {
  return String(entry["dst-host"] || entry.server || "").toLowerCase();
}

function ipKey(entry) {
  return String(entry["dst-address"] || "").split("/")[0];
}

/** Apply payment walled garden on a RouterOS connection (safe — skips dynamic entries). */
export async function applyPaymentWalledGarden(conn, opts = {}) {
  const portalHost = String(opts.portalHost || "jmwifi.pro").trim();
  const portalIp = String(opts.portalIp || "").trim();
  const resolveFn = opts.resolveHostIps || (async () => []);
  const commentTag = opts.commentTag || "GCash PayMongo";
  const removeOurs = opts.removeOurs !== false;

  const wg = await conn.print("/ip/hotspot/walled-garden");
  const wgIp = await conn.print("/ip/hotspot/walled-garden/ip");

  if (removeOurs) {
    for (const e of wg || []) {
      const c = String(e.comment || "");
      if (!c.startsWith(JM)) continue;
      try { await conn.talk(["/ip/hotspot/walled-garden/remove", "=.id=" + e[".id"]]); } catch {}
    }
    for (const e of wgIp || []) {
      const c = String(e.comment || "");
      if (!c.startsWith(JM)) continue;
      try { await conn.talk(["/ip/hotspot/walled-garden/ip/remove", "=.id=" + e[".id"]]); } catch {}
    }
  }

  const existingHosts = new Set((wg || []).map(hostKey).filter(Boolean));
  const existingIps = new Set((wgIp || []).map(ipKey).filter(Boolean));

  const hosts = new Set(PAYMENT_WALLED_GARDEN_HOSTS);
  if (portalHost) {
    hosts.add(portalHost);
    if (!portalHost.startsWith("www.")) hosts.add("www." + portalHost);
  }

  let addedHosts = 0;
  for (const h of hosts) {
    if (existingHosts.has(h.toLowerCase())) continue;
    try {
      await conn.talk([
        "/ip/hotspot/walled-garden/add",
        "=dst-host=" + h,
        "=action=allow",
        "=comment=" + JM + commentTag,
      ]);
      addedHosts++;
    } catch (e) {
      console.log("  wg host skip", h, "—", (e.message || "").split(",")[0]);
    }
  }

  const ips = new Set(PAYMENT_WALLED_GARDEN_STATIC_IPS);
  if (portalIp) ips.add(portalIp);
  try {
    for (const ip of await resolveFn(portalHost)) ips.add(ip);
  } catch {}
  for (const h of ["paymongo.com", "api.paymongo.com", "payments.gcash.com", "gcash.com", "api.mynt.xyz"]) {
    try {
      for (const ip of await resolveFn(h)) ips.add(ip);
    } catch {}
  }

  let addedIps = 0;
  for (const ip of ips) {
    if (!ip || ip.includes(":")) continue;
    if (existingIps.has(ip)) continue;
    try {
      await conn.talk([
        "/ip/hotspot/walled-garden/ip/add",
        "=dst-address=" + ip,
        "=action=accept",
        "=comment=" + JM + commentTag + " ip",
      ]);
      addedIps++;
    } catch (e) {
      console.log("  wg ip skip", ip, "—", (e.message || "").split(",")[0]);
    }
  }

  for (const dns of ["8.8.8.8", "1.1.1.1"]) {
    if (existingIps.has(dns)) continue;
    try {
      await conn.talk([
        "/ip/hotspot/walled-garden/ip/add",
        "=dst-address=" + dns,
        "=protocol=udp",
        "=dst-port=53",
        "=action=accept",
        "=comment=" + JM + "DNS",
      ]);
      addedIps++;
    } catch {}
  }

  return { addedHosts, addedIps, totalHosts: hosts.size, totalIps: ips.size };
}
