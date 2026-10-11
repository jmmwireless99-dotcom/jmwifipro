/**
 * Apply JM WIFI suspended-client firewall to a MikroTik router from billing DB.
 * Usage (on VPS): node deploy/apply-suspend-firewall.mjs [router-name] [WAN-interface]
 * Example: node deploy/apply-suspend-firewall.mjs PPPOE-MAIN
 *
 * IPoE prepaid (address-list IPOE-EXPIRED): node deploy/apply-suspend-firewall.mjs --ipoe [router-name] [WAN]
 */
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import path from "node:path";
import dns from "node:dns/promises";
import { RouterOSAPI } from "../lib/routeros-api.js";
import { PAYMENT_HOSTS, CAPTIVE_HOSTS } from "../lib/payment-whitelist-hosts.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DB = process.env.BILLING_DB || path.join(ROOT, "billing.db");
const cliArgs = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const IPoe_ONLY = process.argv.includes("--ipoe") || process.env.JM_IPOE_MODE === "1";
const DRY_RUN = process.argv.includes("--dry-run");
const ROUTER_NAME = cliArgs[0] || "PPPOE-MAIN";
const WAN_OVERRIDE = cliArgs[1] || process.env.JM_WAN || "";

let LIST = IPoe_ONLY ? (process.env.IPOE_SUSPEND_LIST || "IPOE-EXPIRED") : "suspended";
const JM_TAG = IPoe_ONLY ? "JM ipoe:" : "JM suspend:";
const jm = (s) => JM_TAG + s;
const WL = "payment-whitelist";
const SUSP_PROFILE = "suspended-pool";
const SUSP_POOL = "suspended-pool";
const SUSP_RANGE = "50.0.0.5-50.0.0.254";
const SUSP_GW = "50.0.0.1";
const PORTAL_HOST = "jmwifi.pro";

/** Re-exported from lib/payment-whitelist-hosts.js */

/** tls-host patterns (RouterOS). Apex + wildcard — *.x does NOT match apex. */
const TLS_HOSTS = [
  "jmwifi.pro",
  "*.jmwifi.pro",
  "paymongo.com",
  "*.paymongo.com",
  "pm.link",
  "gcash.com",
  "*.gcash.com",
  "gcashapp.com",
  "*.gcashapp.com",
  "mynt.xyz",
  "*.mynt.xyz",
  "alipay.com",
  "*.alipay.com",
  "alipayobjects.com",
  "*.alipayobjects.com",
  "pulseid.com",
  "*.pulseid.com",
  "paymaya.com",
  "*.paymaya.com",
  "maya.ph",
  "*.maya.ph",
  "xendit.co",
  "*.xendit.co",
];

function getSetting(db, k, fallback = "") {
  const r = db.prepare("SELECT v FROM settings WHERE k=?").get(k);
  return (r && r.v != null ? String(r.v) : fallback).trim();
}

function legacyRouter(db, name) {
  const host = getSetting(db, "mikrotik_host", process.env.MIKROTIK_HOST || "");
  if (!host) return null;
  const hostOnly = host.split(":")[0].trim();
  const port = Number(getSetting(db, "mikrotik_port", process.env.MIKROTIK_PORT || "8728")) || 8728;
  const user = getSetting(db, "mikrotik_user", process.env.MIKROTIK_USER || "");
  let password = getSetting(db, "mikrotik_password", process.env.MIKROTIK_PASSWORD || "");
  if (password === "***") password = process.env.MIKROTIK_PASSWORD || "";
  const ssl = getSetting(db, "mikrotik_ssl", "") === "1" || process.env.MIKROTIK_API_SSL === "true";
  return {
    id: 0,
    name: name || user || "legacy",
    host: hostOnly,
    port,
    username: user,
    password,
    ssl: ssl ? 1 : 0,
    enabled: 1,
    is_default: 1,
  };
}

function findRouter(db, name) {
  let r = db.prepare("SELECT * FROM routers WHERE name=?").get(name);
  if (r) return r;
  r = db.prepare("SELECT * FROM routers WHERE name LIKE ?").get(`%${name}%`);
  if (r) return r;
  r = db.prepare("SELECT * FROM routers WHERE is_default=1 LIMIT 1").get();
  if (r) return r;
  r = db.prepare("SELECT * FROM routers WHERE enabled=1 ORDER BY id LIMIT 1").get();
  if (r) return r;
  return legacyRouter(db, name);
}

async function resolveHostIps(host) {
  const ips = new Set();
  try {
    for (const ip of await dns.resolve4(host)) ips.add(ip);
  } catch {}
  // MikroTik address-list FQDN resolution handles IPv6; skip raw v6 here (invalid on some ROS versions)
  return [...ips];
}

async function resolvePortalIps(db) {
  const pub = getSetting(db, "public_url", "https://jmwifi.pro").replace(/^https?:\/\//, "").split("/")[0];
  const host = pub || PORTAL_HOST;
  const ips = new Set();
  for (const h of [host, PORTAL_HOST, "www." + PORTAL_HOST]) {
    for (const ip of await resolveHostIps(h)) ips.add(ip);
  }
  if (!ips.size) ips.add("187.77.145.131");
  return { host, ips: [...ips] };
}

async function detectWan(conn) {
  if (WAN_OVERRIDE) return WAN_OVERRIDE;
  const routes = await conn.print("/ip/route");
  const def = routes.find((r) => {
    const dst = String(r.dst || r["dst-address"] || "");
    return dst.startsWith("0.0.0.0") && String(r.inactive || "false") !== "true";
  });
  if (def) {
    const gw = String(def["immediate-gw"] || def.gateway || "");
    const viaIface = gw.match(/%([^,\s]+)/);
    if (viaIface) return viaIface[1];
    if (def.interface) return def.interface;
    if (def["gateway-status"]) {
      const m = String(def["gateway-status"]).match(/reachable via (\S+)/);
      if (m) return m[1];
    }
  }
  const ifs = await conn.interfaces();
  const ether = ifs.find((i) => /^ether1$/i.test(i.name) && !i.disabled);
  if (ether) return ether.name;
  const uplink = ifs.find((i) => /^(OSPF|WAN|UPLINK|INTERNET)/i.test(i.name) && !i.disabled);
  if (uplink) return uplink.name;
  const ppp = ifs.find((i) => /pppoe-out|l2tp-out|sstp-out/i.test(i.name) && !i.disabled);
  if (ppp) return ppp.name;
  throw new Error("Could not detect WAN — pass interface as 2nd arg, e.g. OSPF2003");
}

async function upsertPool(conn) {
  const id = await conn.findId("/ip/pool", "name", SUSP_POOL);
  if (id) {
    await conn.setById("/ip/pool", id, { ranges: SUSP_RANGE, comment: "JM: suspended PPPoE pool" });
    return "updated";
  }
  await conn.add("/ip/pool", { name: SUSP_POOL, ranges: SUSP_RANGE, comment: "JM: suspended PPPoE pool" });
  return "created";
}

async function upsertProfile(conn) {
  const attrs = {
    "local-address": SUSP_GW,
    "remote-address": SUSP_POOL,
    "rate-limit": "2M/2M",
    "address-list": LIST,
    "dns-server": SUSP_GW,
    comment: "JM: expired/suspended PPPoE",
  };
  const id = await conn.findId("/ppp/profile", "name", SUSP_PROFILE);
  if (id) {
    await conn.setById("/ppp/profile", id, attrs);
    return "updated";
  }
  await conn.add("/ppp/profile", { name: SUSP_PROFILE, ...attrs });
  return "created";
}

async function removeListByCommentPrefix(conn, list, prefix) {
  const rows = await conn.print("/ip/firewall/address-list", { list });
  let n = 0;
  for (const r of rows || []) {
    const c = String(r.comment || "");
    if (c.startsWith(prefix)) {
      await conn.removeById("/ip/firewall/address-list", r[".id"]);
      n++;
    }
  }
  return n;
}

async function ensureAddrListEntry(conn, list, address, comment) {
  const rows = await conn.print("/ip/firewall/address-list", { list, address });
  if (rows && rows.length) return "exists";
  await conn.addrListAdd(list, address, comment);
  return "added";
}

async function removeByCommentPrefix(conn, menu, prefix) {
  const rows = await conn.print(menu);
  let n = 0;
  for (const r of rows || []) {
    const c = String(r.comment || "");
    if (c.startsWith(prefix)) {
      await conn.removeById(menu, r[".id"]);
      n++;
    }
  }
  return n;
}

async function addFilter(conn, attrs) {
  const words = Object.entries(attrs).filter(([, v]) => v != null && v !== "").map(([k, v]) => `=${k}=${v}`);
  return conn.talk(["/ip/firewall/filter/add", ...words]);
}

async function addNat(conn, attrs) {
  const words = Object.entries(attrs).filter(([, v]) => v != null && v !== "").map(([k, v]) => `=${k}=${v}`);
  return conn.talk(["/ip/firewall/nat/add", ...words]);
}

async function firstForwardDropId(conn) {
  const rows = await conn.print("/ip/firewall/filter", { chain: "forward" });
  // Prefer inserting before the first global drop/reject AFTER any established rule
  let seenEstablished = false;
  for (const r of rows || []) {
    const c = String(r.comment || "").toLowerCase();
    if (r.action === "accept" && String(r["connection-state"] || "").includes("established")) seenEstablished = true;
    const a = String(r.action || "");
    if ((a === "drop" || a === "reject") && !String(r.comment || "").startsWith(JM_TAG)) {
      if (seenEstablished || rows.indexOf(r) > 2) return r[".id"];
    }
  }
  for (const r of rows || []) {
    const a = String(r.action || "");
    if (a === "drop" || a === "reject") return r[".id"];
  }
  return rows && rows.length ? rows[0][".id"] : null;
}

/** Remove global captive DNS overrides — they hijack Android/iOS checks for ALL clients using router DNS. */
async function removeCaptiveDns(conn) {
  const rm = await removeByCommentPrefix(conn, "/ip/dns/static", "JM captive:");
  console.log("Removed global captive DNS entries (fixes active clients seeing pay portal):", rm);
  if (rm === 0) {
    // Legacy entries without JM comment prefix
    const rows = await conn.print("/ip/dns/static");
    let legacy = 0;
    for (const r of rows || []) {
      const name = String(r.name || "").toLowerCase();
      if (CAPTIVE_HOSTS.some((h) => h.toLowerCase() === name)) {
        await conn.removeById("/ip/dns/static", r[".id"]);
        legacy++;
      }
    }
    if (legacy) console.log("Removed legacy captive DNS entries:", legacy);
  }
}

async function applyCaptiveNat(conn) {
  const rules = [
    { chain: "dstnat", "src-address-list": LIST, protocol: "udp", "dst-port": "53", action: "redirect", "to-ports": "53", comment: jm("force DNS to router") },
    { chain: "dstnat", "src-address-list": LIST, protocol: "tcp", "dst-port": "53", action: "redirect", "to-ports": "53", comment: jm("force DNS tcp to router") },
  ];
  for (const rule of rules) {
    await addNat(conn, rule);
  }
}

async function syncPaymentWhitelist(conn, portalIps) {
  const rm = await removeListByCommentPrefix(conn, WL, "JM:");
  console.log("Cleared old", WL, "JM entries:", rm);

  for (const host of PAYMENT_HOSTS) {
    const st = await ensureAddrListEntry(conn, WL, host, `JM: ${host}`);
    console.log(" ", WL, host, st);
  }

  const allIps = new Set(portalIps);
  for (const host of PAYMENT_HOSTS) {
    for (const ip of await resolveHostIps(host)) allIps.add(ip);
  }
  for (const ip of allIps) {
    const st = await ensureAddrListEntry(conn, WL, ip, `JM: ip ${ip}`);
    console.log(" ", WL, ip, st);
  }
  console.log("Resolved IPs for whitelist:", allIps.size);
}

async function applyFirewallRules(conn, wan, portalIps, placeBefore) {
  const pb = placeBefore ? { "place-before": placeBefore } : {};
  const src = { "src-address-list": LIST };

  // Rules are evaluated top-to-bottom. Array order = add order = evaluation order.
  // ACCEPT rules first, REJECT/DROP last.
  const rules = [
    { chain: "forward", ...src, protocol: "udp", "dst-port": "53", action: "accept", comment: jm("DNS udp") },
    { chain: "forward", ...src, protocol: "tcp", "dst-port": "53", action: "accept", comment: jm("DNS tcp") },
    ...portalIps.map((ip) => ({
      chain: "forward", ...src, "dst-address": ip, action: "accept", comment: jm(`portal ${ip}`),
    })),
    { chain: "forward", ...src, "dst-address-list": WL, action: "accept", comment: jm("payment whitelist") },
    { chain: "forward", ...src, protocol: "udp", "dst-port": "443", "dst-address-list": WL, action: "accept", comment: jm("payment QUIC (GCash app)") },
    { chain: "forward", ...src, protocol: "tcp", "dst-port": "80,443", "dst-address-list": WL, action: "accept", comment: jm("payment HTTP/S by list") },
    ...TLS_HOSTS.map((host) => ({
      chain: "forward", ...src, protocol: "tcp", "dst-port": "443", "tls-host": host, action: "accept", comment: jm(`tls ${host}`),
    })),
    { chain: "forward", ...src, "connection-state": "established,related", action: "accept", comment: jm("established") },
    { chain: "forward", ...src, "out-interface": wan, action: "reject", "reject-with": "icmp-network-unreachable", comment: jm("block internet") },
    { chain: "forward", ...src, action: "drop", comment: jm("drop remainder") },
  ];

  for (const rule of rules) {
    await addFilter(conn, { ...rule, ...pb });
  }
}

/** Ensure DROP/REJECT are last — first match wins, so drop-at-top blocks all whitelist traffic. */
async function ensureJmRuleOrder(conn) {
  let fwd = await conn.print("/ip/firewall/filter", { chain: "forward" });
  const drop = fwd.find((r) => r.comment === jm("drop remainder"));
  const reject = fwd.find((r) => r.comment === jm("block internet"));
  if (!drop) return;

  const move = async (id, destination) => {
    const words = ["/ip/firewall/filter/move", "=.id=" + id];
    if (destination) words.push("=destination=" + destination);
    await conn.talk(words);
  };

  // Move drop to absolute end of forward chain.
  try {
    await move(drop[".id"]);
  } catch (e) {
    console.warn("  move drop to end:", e.message || e);
  }

  fwd = await conn.print("/ip/firewall/filter", { chain: "forward" });
  const dropNow = fwd.find((r) => r.comment === jm("drop remainder"));
  const rejectNow = fwd.find((r) => r.comment === jm("block internet"));
  if (rejectNow && dropNow) {
    try {
      await move(rejectNow[".id"], dropNow[".id"]);
    } catch (e) {
      console.warn("  move reject before drop:", e.message || e);
    }
  }

  fwd = await conn.print("/ip/firewall/filter", { chain: "forward" });
  const jmRules = fwd.filter((r) => String(r.comment || "").startsWith(JM_TAG));
  const globalEst = fwd.find(
    (r) => r.action === "accept" && String(r["connection-state"] || "").includes("established") && !String(r.comment || "").startsWith(JM_TAG)
  );
  if (globalEst && jmRules.length) {
    const firstJm = jmRules[0];
    const dest = fwd[fwd.indexOf(globalEst) + 1]?.[".id"];
    if (dest && firstJm[".id"] !== dest) {
      try {
        await move(firstJm[".id"], dest);
        console.log("Placed JM block after global established rule");
      } catch (e) {
        console.warn("  place after established:", e.message || e);
      }
    }
  }

  fwd = await conn.print("/ip/firewall/filter", { chain: "forward" });
  const idx = (c) => fwd.findIndex((r) => r.comment === c);
  console.log(
    "Rule order check — DNS:",
    idx(jm("DNS udp")),
    "reject:",
    idx(jm("block internet")),
    "drop:",
    idx(jm("drop remainder")),
    "/ total:",
    fwd.length
  );
}

async function main() {
  const db = new DatabaseSync(DB);
  if (IPoe_ONLY) {
    LIST = getSetting(db, "ipoe_suspend_list", process.env.IPOE_SUSPEND_LIST || "IPOE-EXPIRED") || "IPOE-EXPIRED";
  }
  let row = findRouter(db, ROUTER_NAME);
  if (process.env.MIKROTIK_HOST && process.env.MIKROTIK_PASSWORD) {
    row = {
      ...(row || {}),
      name: row?.name || ROUTER_NAME,
      host: process.env.MIKROTIK_HOST.split(":")[0],
      port: Number(process.env.MIKROTIK_PORT || row?.port || 8728),
      username: process.env.MIKROTIK_USER || row?.username || "",
      password: process.env.MIKROTIK_PASSWORD,
      ssl: process.env.MIKROTIK_API_SSL === "true" ? 1 : 0,
    };
  }
  if (!row || !row.host) {
    console.error("No router found for:", ROUTER_NAME, "— add a router in billing or set mikrotik_host in Settings.");
    process.exit(1);
  }
  if (!row.password) {
    console.error("No MikroTik password — set mikrotik_password in Settings or MIKROTIK_PASSWORD on the server.");
    process.exit(1);
  }

  const { host: portalHost, ips: portalIps } = await resolvePortalIps(db);
  const conn = new RouterOSAPI({
    host: String(row.host).split(":")[0],
    user: row.username || "",
    password: row.password || "",
    port: Number(row.port) || (row.ssl ? 8729 : 8728),
    ssl: !!row.ssl,
    timeout: 20000,
  });

  console.log("Connecting to", row.name, "@", row.host + ":" + (row.port || 8728), "…");
  const ident = await conn.identity();
  console.log("Router identity:", ident.name || ident);

  const wan = await detectWan(conn);
  console.log("WAN interface:", wan);
  console.log("Mode:", IPoe_ONLY ? "IPoE prepaid (IPOE-EXPIRED)" : "PPPoE + shared suspend");
  console.log("Portal", portalHost, "IPs:", portalIps.join(", "));
  console.log("Address-list:", LIST, IPoe_ONLY ? "" : ("| Profile: " + SUSP_PROFILE + " | Pool: " + SUSP_RANGE));

  if (!IPoe_ONLY) {
    const pool = await upsertPool(conn);
    const prof = await upsertProfile(conn);
    console.log("Pool", pool, "| Profile", prof);
  }

  await syncPaymentWhitelist(conn, portalIps);
  await removeCaptiveDns(conn);

  const rmF = await removeByCommentPrefix(conn, "/ip/firewall/filter", JM_TAG);
  const rmN = await removeByCommentPrefix(conn, "/ip/firewall/nat", JM_TAG);
  console.log("Removed old rules — filter:", rmF, "nat:", rmN);

  await applyCaptiveNat(conn);

  for (const ip of portalIps) {
    await addNat(conn, {
      chain: "dstnat",
      protocol: "tcp",
      "dst-port": "80",
      "src-address-list": LIST,
      action: "dst-nat",
      "to-addresses": ip,
      "to-ports": "80",
      comment: jm("HTTP redirect to portal"),
    });
  }

  const placeBefore = await firstForwardDropId(conn);
  if (placeBefore) console.log("Insert JM rules before forward rule:", placeBefore);
  await applyFirewallRules(conn, wan, portalIps, placeBefore);
  await ensureJmRuleOrder(conn);

  console.log("Firewall rules applied.");

  if (IPoe_ONLY) {
    db.prepare("INSERT INTO settings (k,v) VALUES ('ipoe_suspend_list',?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").run(LIST);
    console.log("Billing setting ipoe_suspend_list =", LIST);
  } else {
    db.prepare("INSERT INTO settings (k,v) VALUES ('suspended_profile',?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").run(SUSP_PROFILE);
    console.log("Billing setting suspended_profile =", SUSP_PROFILE);
  }

  if (!IPoe_ONLY) {
    const profiles = await conn.pppProfiles();
    const sp = profiles.find((p) => p.name === SUSP_PROFILE);
    console.log("\nSuspended profile:", JSON.stringify({
      name: sp?.name,
      "local-address": sp?.["local-address"],
      "remote-address": sp?.["remote-address"],
      "address-list": sp?.["address-list"],
      "rate-limit": sp?.["rate-limit"],
    }));
  }

  const wl = await conn.print("/ip/firewall/address-list", { list: WL });
  console.log("payment-whitelist entries:", (wl || []).length);

  const jmRules = (await conn.print("/ip/firewall/filter")).filter((r) => String(r.comment || "").startsWith(JM_TAG));
  console.log(JM_TAG, "filter rules:", jmRules.length);

  console.log("\nDone. Expired client should open https://jmwifi.pro/account and PayMongo/GCash checkout.");
  try { conn.close && conn.close(); } catch {}
}

main().catch((e) => {
  console.error("FAILED:", e.message || e);
  process.exit(1);
});
