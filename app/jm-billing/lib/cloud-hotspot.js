import { hotspotWalledGardenCommands } from "./payment-whitelist-hosts.js";

export function cloudHotspotConfig(opts = {}) {
  const portal = String(opts.portalUrl || "https://jmwifi.pro").replace(/\/$/, "");
  const radiusHost = opts.radiusHost || "187.77.145.131";
  const radiusSecret = opts.radiusSecret || "JmWifi@Radius2026!";
  const site = opts.routerName || "site";
  const wan = opts.wanInterface || "ether1";
  const files = ["login.html", "alogin.html", "logout.html", "error.html", "kitifi-buy.html", "kitifi-autoconnect.js"];
  const fetchLines = files.map((f) =>
    ':do { /tool fetch url="' + portal + "/hotspot/" + f + '" dst-path=flash/hotspot/' + f + ' mode=https check-certificate=no' +
    ' } on-error={ :log warning ("JM WIFI: fetch ' + f + ' failed") }'
  );
  const lines = [
    "# JM WIFI Cloud Hotspot — " + site,
    "# Central billing + RADIUS: " + portal,
    "# One voucher works on ALL JM WIFI sites (any SSID / barangay).",
    "",
    '/radius remove [find comment~"JM WIFI cloud"]',
    '/radius add service=hotspot address=' + radiusHost + ' secret="' + radiusSecret + '" authentication-port=1812 accounting-port=1813 timeout=3s comment="JM WIFI cloud RADIUS"',
    "",
    "/ip hotspot profile set [find] use-radius=yes radius-accounting=yes radius-interim-update=5m",
    "/ip hotspot profile set [find] login-by=http-chap,http-pap,cookie",
    "/ip hotspot profile set [find] mac-cookie-timeout=3d",
    "/ip hotspot profile set [find] html-directory=flash/hotspot",
    "",
    "# Download login page with Buy Voucher button from cloud server",
    ...fetchLines,
    "",
    '/ip hotspot walled-garden remove [find comment~"JM WIFI cloud"]',
    '/ip hotspot walled-garden remove [find comment~"JM "]',
    ...hotspotWalledGardenCommands({ portalHost: portal.replace(/^https?:\/\//, "").split("/")[0], portalIp: radiusHost })
      .split("\n")
      .filter((line) => line.startsWith("/ip hotspot walled-garden add")),
    '/ip hotspot walled-garden ip add dst-address=' + radiusHost + ' comment="JM billing RADIUS"',
    "",
    "# Suspended PPPoE/IPoE — redirect to pay portal",
    '/ip firewall nat remove [find comment~"JM WIFI cloud suspend"]',
    '/ip firewall filter remove [find comment~"JM WIFI cloud suspend"]',
    "/ip firewall nat add chain=dstnat protocol=tcp dst-port=80 src-address-list=IPOE-EXPIRED action=dst-nat to-addresses=" + radiusHost + " to-ports=443 comment=\"JM WIFI cloud suspend\"",
    "/ip firewall filter add chain=forward src-address-list=IPOE-EXPIRED dst-address=" + radiusHost + " action=accept comment=\"JM WIFI cloud suspend portal\"",
    "/ip firewall filter add chain=forward src-address-list=IPOE-EXPIRED protocol=udp dst-port=53 action=accept comment=\"JM WIFI cloud suspend DNS\"",
    "/ip firewall filter add chain=forward src-address-list=IPOE-EXPIRED out-interface=" + wan + " action=reject reject-with=icmp-network-unreachable comment=\"JM WIFI cloud suspend block\"",
    "",
    ':put "JM WIFI cloud hotspot ready — voucher shop: ' + portal + '/voucher"',
  ];
  return {
    portalUrl: portal,
    radiusHost,
    radiusSecret,
    routerName: site,
    script: lines.join("\n"),
    voucherUrl: portal + "/voucher",
    walledGarden: ["jmwifi.pro", "paymongo.com", "gcash.com"],
  };
}

export function cloudHotspotForRouter(router, settings = {}) {
  const portal = (settings.public_url || "https://jmwifi.pro").trim();
  const radiusHost = (settings.radius_host || "187.77.145.131").trim();
  const radiusSecret = (settings.radius_secret || "JmWifi@Radius2026!").trim();
  return cloudHotspotConfig({
    portalUrl: portal,
    radiusHost,
    radiusSecret,
    routerName: router?.name || "site",
  });
}
