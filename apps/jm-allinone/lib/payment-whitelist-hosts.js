/** Domains clients must reach to pay online (portal + PayMongo + GCash + QR Ph wallets). */
export const PAYMENT_HOSTS = [
  "jmwifi.pro",
  "www.jmwifi.pro",
  "paymongo.com",
  "www.paymongo.com",
  "api.paymongo.com",
  "checkout.paymongo.com",
  "link.paymongo.com",
  "links.paymongo.com",
  "files.paymongo.com",
  "static.paymongo.com",
  "cdn.paymongo.com",
  "pm.link",
  "gcash.com",
  "www.gcash.com",
  "m.gcash.com",
  "payments.gcash.com",
  "api.m.gcash.com",
  "api.gcash.com",
  "login.gcash.com",
  "merchant.gcash.com",
  "fuse.gcash.com",
  "new-fuse.gcash.com",
  "s.gcash.com",
  "usercontent.gcash.com",
  "gcashapp.com",
  "webpay.gcash.com",
  "kyc.gcash.com",
  "apps.gcash.com",
  "cdn.gcash.com",
  "static.gcash.com",
  "user-profile-prd.gcash.com",
  "gcash-api.pulseid.com",
  "api.mynt.xyz",
  "login.mynt.xyz",
  "mss.paas.mynt.xyz",
  "mdap.paas.mynt.xyz",
  "mgs-gw.paas.mynt.xyz",
  "customer-segment-api.mynt.xyz",
  "irisk-sea.alipay.com",
  "gw.alipayobjects.com",
  "alipay.com",
  "miniprogram.gcash.com",
  "paymaya.com",
  "www.paymaya.com",
  "maya.ph",
  "gotyme.com",
  "xendit.co",
  "checkout.xendit.co",
  "api.xendit.co",
  "tapi.xendit.co",
  "fonts.googleapis.com",
  "fonts.gstatic.com",
  "cdn.jsdelivr.net",
];

export const CAPTIVE_HOSTS = [
  "connectivitycheck.gstatic.com",
  "connectivitycheck.android.com",
  "clients3.google.com",
  "www.gstatic.com",
  "captive.apple.com",
  "www.apple.com",
  "www.msftconnecttest.com",
  "msftconnecttest.com",
  "detectportal.firefox.com",
];

/** MikroTik walled-garden lines for unauthenticated hotspot users (buy voucher + GCash). */
export function hotspotWalledGardenCommands(opts = {}) {
  const portalHost = String(opts.portalHost || "jmwifi.pro").replace(/^https?:\/\//, "").split("/")[0].split(":")[0];
  const portalIp = String(opts.portalIp || "").trim();
  const seen = new Set();
  const lines = [
    "# === Hotspot walled-garden: portal + online payment (GCash / PayMongo / QR Ph) ===",
    "# Paste on each hotspot router so clients WITHOUT WiFi time can buy vouchers.",
    "",
  ];
  const addHost = (host, comment) => {
    const h = String(host || "").trim().toLowerCase();
    if (!h || seen.has(h)) return;
    seen.add(h);
    lines.push(`/ip hotspot walled-garden add dst-host=${h} comment="${comment}"`);
  };
  addHost(portalHost, "JM billing portal");
  addHost("jmwifi.pro", "JM billing portal");
  addHost("www.jmwifi.pro", "JM billing portal");
  if (portalIp && portalIp !== portalHost) {
    lines.push(`/ip hotspot walled-garden ip add dst-address=${portalIp} comment="JM billing portal IP"`);
  }
  for (const h of CAPTIVE_HOSTS) addHost(h, "JM captive portal probe");
  for (const h of PAYMENT_HOSTS) addHost(h, "JM online payment");
  lines.push("");
  lines.push(`# Voucher page: https://${portalHost}/voucher`);
  lines.push(`# Hotspot login link example: https://${portalHost}/voucher?link-login=http://192.168.88.1/login`);
  return lines.join("\n");
}
