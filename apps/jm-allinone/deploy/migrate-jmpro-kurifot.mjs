/**
 * Migrate PPPOE-JMPRO from Kurifot reminder system → JM WIFI billing (jmwifi.pro).
 * - Removes Kurifot webhooks, domains, old reminder profiles/rules
 * - Keeps plan pools/profiles + PAYMENT_ALLOW bank list
 * - Uses suspended-pool profile → address-list "suspended"
 * - HTTP redirect via local web-proxy :8080 (tested captive portal pattern)
 *
 * Usage: node deploy/migrate-jmpro-kurifot.mjs [router-name]
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Routers, Settings } from "../lib/db.js";
import { RouterOSAPI } from "../lib/routeros-api.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
process.chdir(path.resolve(__dirname, ".."));

const ROUTER_NAME = process.argv[2] || "PPPOE-JMPRO";
const LIST = "suspended";
const SUSP_PROFILE = Settings.get("suspended_profile", "suspended-pool") || "suspended-pool";
const SUSP_POOL = "suspended-pool";
const SUSP_RANGE = "50.0.0.5-50.0.0.254";
const SUSP_LOCAL = "50.0.0.1";
const PROXY_PORT = 8080;

function portalIp() {
  const pub = Settings.get("public_url", "https://jmwifi.pro") || "https://jmwifi.pro";
  const host = pub.replace(/^https?:\/\//, "").split("/")[0].split(":")[0];
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return host;
  return "187.77.145.131";
}
const PORTAL_IP = portalIp();

const JMWIFI_PORTAL = [
  ["jmwifi.pro", "JM: billing portal"],
  ["www.jmwifi.pro", "JM: billing portal"],
  [PORTAL_IP, "JM: billing VPS"],
];

const PAYMENT_EXTRA = [
  ["paymongo.com", "JM: PayMongo"],
  ["api.paymongo.com", "JM: PayMongo API"],
  ["pm.link", "JM: PayMongo checkout"],
];

const REMOVE_PROFILES = new Set(["EXPIRED_PROFILE", "GRACE_PROFILE", "Reminder"]);
const REMOVE_LISTS = new Set(["KURIFOT_DOMAINS"]);
const REMOVE_COMMENT = /KURIFOT|Kurifot|kurifot|PPP Reminder|GRACE PORTAL|PPPOE PORTAL|JM suspend|JM WIFI/i;

async function removeLegacyReminderRules(conn) {
  let n = 0;
  for (const menu of ["/ip/firewall/nat", "/ip/firewall/filter"]) {
    const rows = await conn.print(menu);
    const ids = (rows || [])
      .filter((row) => {
        const c = String(row.comment || "");
        const src = String(row["src-address-list"] || "");
        return REMOVE_COMMENT.test(c) || src === "ppp_reminder" || src === "GRACE_USERS";
      })
      .map((r) => r[".id"])
      .filter(Boolean);
    for (const id of ids.reverse()) {
      try { await conn.removeById(menu, id); n++; } catch {}
    }
  }
  return n;
}

function connFor(r) {
  return new RouterOSAPI({
    host: (r.host || "").split(":")[0],
    user: r.username,
    password: r.password,
    port: Number(r.port) || (r.ssl ? 8729 : 8728),
    ssl: !!r.ssl,
    timeout: 20000,
  });
}

async function detectWan(conn) {
  try {
    const routes = await conn.print("/ip/route", { "?dst-address": "0.0.0.0/0", "?active": "yes" });
    const hit = (routes || []).find((x) => x["dst-address"] === "0.0.0.0/0" && x.interface);
    if (hit?.interface) return hit.interface;
  } catch {}
  try {
    const routes = await conn.print("/ip/route");
    const hit = (routes || []).find((x) => String(x["dst-address"] || "").startsWith("0.0.0.0/0") && x.interface);
    if (hit?.interface) return hit.interface;
  } catch {}
  return "ether1-ISP";
}

async function removeByComment(conn, menu, test) {
  const rows = await conn.print(menu);
  const ids = (rows || []).filter((row) => test(String(row.comment || ""))).map((r) => r[".id"]).filter(Boolean);
  for (const id of ids.reverse()) {
    try { await conn.removeById(menu, id); } catch {}
  }
  return ids.length;
}

async function removeListEntries(conn, listName) {
  const rows = await conn.print("/ip/firewall/address-list", { "?list": listName });
  const ids = (rows || []).map((r) => r[".id"]).filter(Boolean);
  for (const id of ids.reverse()) {
    try {
      await conn.removeById("/ip/firewall/address-list", id);
    } catch {}
  }
  return ids.length;
}

async function ensureAddrList(conn, list, entries) {
  const existing = await conn.print("/ip/firewall/address-list", { "?list": list });
  const have = new Set((existing || []).map((x) => x.address));
  let n = 0;
  for (const [addr, comment] of entries) {
    if (have.has(addr)) continue;
    try {
      await conn.addrListAdd(list, addr, comment);
      n++;
    } catch (e) {
      if (!/already have/i.test(String(e.message || ""))) throw e;
    }
  }
  return n;
}

async function ensurePool(conn) {
  const id = await conn.findId("/ip/pool", "name", SUSP_POOL);
  if (id) {
    await conn.setById("/ip/pool", id, { ranges: SUSP_RANGE, comment: "JM: expired/suspended PPPoE pool" });
  } else {
    await conn.poolAdd({ name: SUSP_POOL, ranges: SUSP_RANGE });
  }
}

async function ensureSuspendedProfile(conn) {
  const id = await conn.findId("/ppp/profile", "name", SUSP_PROFILE);
  const attrs = {
    "local-address": SUSP_LOCAL,
    "remote-address": SUSP_POOL,
    "rate-limit": "512k/512k",
    "address-list": LIST,
    "dns-server": "8.8.8.8,8.8.4.4",
    comment: "JM WIFI: expired/suspended — billing moves user here via API",
  };
  if (id) await conn.setById("/ppp/profile", id, attrs);
  else await conn.add("/ppp/profile", { name: SUSP_PROFILE, ...attrs });
  // Clear old Kurifot on-up/on-down scripts if present
  const pid = id || (await conn.findId("/ppp/profile", "name", SUSP_PROFILE));
  if (pid) {
    try { await conn.setById("/ppp/profile", pid, { "on-up": "", "on-down": "" }); } catch {}
  }
}

async function removeLegacyProfiles(conn) {
  const profiles = await conn.print("/ppp/profile");
  let n = 0;
  for (const p of profiles || []) {
    if (!REMOVE_PROFILES.has(p.name)) continue;
    await conn.removeById("/ppp/profile", p[".id"]);
    n++;
    console.log("  removed profile:", p.name);
  }
  return n;
}

async function setupProxy(conn) {
  try {
    await conn.talk(["/ip/proxy/set", "=enabled=yes", "=anonymous=yes", "=port=" + PROXY_PORT]);
  } catch {}
  const access = await conn.print("/ip/proxy/access");
  const kurifotIds = (access || [])
    .filter((row) => /kurifot|fetch\.kurifot/i.test(String(row["dst-host"] || "")))
    .map((r) => r[".id"])
    .filter(Boolean);
  for (const id of kurifotIds.reverse()) {
    try { await conn.removeById("/ip/proxy/access", id); } catch {}
  }
  const fresh = await conn.print("/ip/proxy/access");
  const have = new Set((fresh || []).map((x) => x["dst-host"]));
  const rules = [
    ["jmwifi.pro", "JM: allow portal host"],
    ["www.jmwifi.pro", "JM: allow portal host"],
    ["paymongo.com", "JM: PayMongo via proxy"],
    ["api.paymongo.com", "JM: PayMongo API via proxy"],
  ];
  for (const [host, comment] of rules) {
    if (have.has(host)) continue;
    try {
      await conn.talk([
        "/ip/proxy/access/add",
        "=action=allow",
        "=src-address=50.0.0.0/24",
        "=dst-host=" + host,
        "=comment=" + comment,
      ]);
    } catch (e) {
      console.log("  proxy access skip", host, "—", e.message);
    }
  }
}

async function applyFirewall(conn, wan) {
  const removed = await removeLegacyReminderRules(conn);
  console.log("  removed legacy/duplicate rules:", removed);

  await conn.talk([
    "/ip/firewall/nat/add",
    "=chain=dstnat", "=protocol=tcp", "=dst-port=80",
    "=src-address-list=" + LIST,
    "=action=redirect", "=to-ports=" + PROXY_PORT,
    "=comment=JM WIFI: suspended HTTP → web-proxy portal",
  ]);

  const filters = [
    ["=src-address-list=" + LIST, "=protocol=udp", "=dst-port=53", "=action=accept", "=comment=JM WIFI: suspended allow DNS udp"],
    ["=src-address-list=" + LIST, "=protocol=tcp", "=dst-port=53", "=action=accept", "=comment=JM WIFI: suspended allow DNS tcp"],
    ["=src-address-list=" + LIST, "=dst-address-list=JMWIFI_PORTAL", "=protocol=tcp", "=dst-port=80,443", "=action=accept", "=comment=JM WIFI: portal access"],
    ["=src-address-list=" + LIST, "=dst-address-list=PAYMENT_ALLOW", "=protocol=tcp", "=dst-port=80,443,8080", "=action=accept", "=comment=JM WIFI: online payments"],
    ["=src-address-list=" + LIST, "=dst-address-list=PAYMENT_ALLOW", "=protocol=udp", "=dst-port=443", "=action=accept", "=comment=JM WIFI: payment UDP"],
    ["=src-address-list=" + LIST, "=protocol=tcp", "=dst-port=443", "=tls-host=" + "*.jmwifi.pro", "=action=accept", "=comment=JM WIFI: tls jmwifi"],
    ["=src-address-list=" + LIST, "=protocol=tcp", "=dst-port=443", "=tls-host=" + "*.paymongo.com", "=action=accept", "=comment=JM WIFI: tls PayMongo"],
    ["=src-address-list=" + LIST, "=protocol=tcp", "=dst-port=443", "=tls-host=" + "*.gcash.com", "=action=accept", "=comment=JM WIFI: tls GCash"],
    ["=src-address-list=" + LIST, "=out-interface=" + wan, "=action=reject", "=reject-with=icmp-network-unreachable", "=comment=JM WIFI: suspended block internet"],
  ];
  for (const parts of filters) {
    await conn.talk(["/ip/firewall/filter/add", "=chain=forward", ...parts]);
  }
  console.log("  added JM WIFI rules (WAN=" + wan + ", proxy :" + PROXY_PORT + ")");
}

async function main() {
  const routers = Routers.list();
  const r = routers.find((x) => x.name === ROUTER_NAME) || routers.find((x) => x.is_default);
  if (!r) throw new Error("Router not found: " + ROUTER_NAME);

  console.log("=== JM WIFI migration:", r.name, "→", r.host + ":" + (r.port || 8728), "===");
  console.log("Portal:", "https://jmwifi.pro/account", "| VPS:", PORTAL_IP);
  console.log("Suspend profile:", SUSP_PROFILE, "| address-list:", LIST);

  const conn = connFor(r);
  const ident = await conn.identity();
  console.log("Connected:", ident?.name || "ok");

  console.log("\n1) Remove legacy Kurifot profiles");
  await removeLegacyProfiles(conn);

  console.log("\n2) Suspended pool + profile");
  await ensurePool(conn);
  await ensureSuspendedProfile(conn);

  console.log("\n3) Address lists");
  for (const list of REMOVE_LISTS) {
    const n = await removeListEntries(conn, list);
    if (n) console.log("  cleared list:", list, "(" + n + " entries)");
  }
  const jm = await ensureAddrList(conn, "JMWIFI_PORTAL", JMWIFI_PORTAL);
  console.log("  JMWIFI_PORTAL +", jm, "entries");
  const pay = await ensureAddrList(conn, "PAYMENT_ALLOW", PAYMENT_EXTRA);
  console.log("  PAYMENT_ALLOW +", pay, "entries (PayMongo)");

  console.log("\n4) Web proxy (portal redirect)");
  await setupProxy(conn);

  console.log("\n5) Firewall + NAT");
  const wan = await detectWan(conn);
  await applyFirewall(conn, wan);

  Settings.set("suspended_profile", SUSP_PROFILE);
  if (!Settings.get("public_url")) Settings.set("public_url", "https://jmwifi.pro");
  Routers.setStatus(r.id, "ok");

  console.log("\nDone.");
  console.log("Billing sync: JM WIFI moves expired users to profile", SUSP_PROFILE);
  console.log("Test: suspend user → reconnect → http://neverssl.com → jmwifi.pro/account");
  console.log("Old Kurifot fetch.kurifotremoteall.org webhooks removed — no longer needed.");
  conn.close?.();
}

main().catch((e) => {
  console.error("FAILED:", e.message || e);
  process.exit(1);
});
