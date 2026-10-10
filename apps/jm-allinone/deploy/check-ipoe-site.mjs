/**
 * Full IPoE site check for a billing router (default: IPOE-CABDELARIA).
 * Usage: BILLING_DB=/opt/jm-billing/billing.db node deploy/check-ipoe-site.mjs [router-name]
 */
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { RouterOSAPI } from "../lib/routeros-api.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DB = process.env.BILLING_DB || path.join(ROOT, "billing.db");
const ROUTER_NAME = process.argv[2] || "IPOE-CABDELARIA";

function findRouter(db, name) {
  return (
    db.prepare("SELECT * FROM routers WHERE name=?").get(name) ||
    db.prepare("SELECT * FROM routers WHERE name LIKE ? LIMIT 1").get(`%${name}%`) ||
    db.prepare("SELECT * FROM routers WHERE is_default=1 LIMIT 1").get()
  );
}

async function main() {
  const db = new DatabaseSync(DB);
  const row = findRouter(db, ROUTER_NAME);
  const pwSetting = db.prepare("SELECT v FROM settings WHERE k='mikrotik_password'").get()?.v;
  const pass = row?.password && row.password !== "***" ? row.password : pwSetting;

  console.log("=== BILLING DB ===");
  console.log("DB:", DB);
  console.log("Router:", row?.name, "| id:", row?.id, "| host:", `${row?.host}:${row?.port}`, "| user:", row?.username);
  console.log("last_status:", row?.last_status, "| last_seen:", row?.last_seen);
  console.log("ipoe_suspend_list:", db.prepare("SELECT v FROM settings WHERE k='ipoe_suspend_list'").get()?.v || "IPOE-EXPIRED");
  console.log("dry_run:", db.prepare("SELECT v FROM settings WHERE k='dry_run'").get()?.v || "0");

  const ipoeCust = db.prepare("SELECT id,name,mac,static_ip,vlan_iface,router_id,status,plan_id FROM customers WHERE conn_type='ipoe' AND router_id=?").all(row?.id);
  console.log("\nIPoE customers on this site:", ipoeCust.length);
  for (const c of ipoeCust) {
    console.log(" ", c.id, c.name, "|", c.static_ip, c.mac, "| dhcp:", c.vlan_iface || "(missing)", "|", c.status);
  }

  if (!row?.host || !pass) {
    console.error("\nMissing router host or password.");
    process.exit(1);
  }

  const conn = new RouterOSAPI({
    host: String(row.host).split(":")[0],
    user: row.username,
    password: pass,
    port: Number(row.port) || 8728,
    ssl: !!row.ssl,
    timeout: 25000,
  });

  try {
    const ident = await conn.identity();
    const res = (await conn.print("/system/resource"))?.[0] || {};
    console.log("\n=== MIKROTIK API ===");
    console.log("CONNECTED: YES");
    console.log("Identity:", ident.name || ident);
    console.log("Version:", res.version, "| uptime:", res.uptime);
  } catch (e) {
    console.log("\n=== MIKROTIK API ===");
    console.log("CONNECTED: NO —", e.message);
    process.exit(1);
  }

  const filters = await conn.print("/ip/firewall/filter");
  const nats = await conn.print("/ip/firewall/nat");
  const addrLists = await conn.print("/ip/firewall/address-list");
  const jmIpoeFilter = filters.filter((r) => String(r.comment || "").startsWith("JM ipoe:"));
  const jmIpoeNat = nats.filter((r) => String(r.comment || "").startsWith("JM ipoe:"));
  const ipoeExpired = addrLists.filter((r) => r.list === "IPOE-EXPIRED");
  const wlIpoe = addrLists.filter((r) => r.list === "payment-whitelist" && String(r.comment || "").includes("JM ipoe"));

  console.log("\n=== IPoE FIREWALL ===");
  console.log("JM ipoe filter rules:", jmIpoeFilter.length, jmIpoeFilter.length >= 20 ? "(OK)" : "(INCOMPLETE)");
  console.log("JM ipoe NAT rules:", jmIpoeNat.length, jmIpoeNat.length >= 2 ? "(OK)" : "(INCOMPLETE)");
  console.log("payment-whitelist (JM ipoe):", wlIpoe.length);
  console.log("IPOE-EXPIRED entries:", ipoeExpired.length);

  const ifaces = await conn.print("/interface");
  const ipoeIfaces = ifaces.filter((i) => /IPOE/i.test(String(i.name || "")));
  console.log("\n=== IPoE INTERFACES ===");
  if (ipoeIfaces.length) {
    for (const v of ipoeIfaces) console.log(" ", v.name, "| running:", v.running, "| disabled:", v.disabled);
  } else console.log(" (none with IPOE in name)");

  const addrs = await conn.print("/ip/address");
  console.log("\n=== IP ADDRESSES (IPoE-related) ===");
  for (const a of addrs) {
    const n = `${a.address || ""} ${a.interface || ""}`;
    if (/IPOE|172\.30/i.test(n)) console.log(" ", a.address, "on", a.interface);
  }

  const pools = await conn.print("/ip/pool");
  console.log("\n=== POOLS (IPoE-related) ===");
  for (const p of pools) {
    if (/IPOE/i.test(String(p.name || ""))) console.log(" ", p.name, "|", p.ranges);
  }

  const dhcp = await conn.print("/ip/dhcp-server");
  console.log("\n=== DHCP SERVERS ===");
  for (const d of dhcp) {
    console.log(" ", d.name, "| iface:", d.interface, "| pool:", d["address-pool"], "| disabled:", d.disabled);
  }

  const leases = await conn.print("/ip/dhcp-server/lease");
  const staticLeases = leases.filter((l) => String(l.dynamic) === "false" || l.dynamic === false);
  console.log("\n=== STATIC DHCP LEASES ===", staticLeases.length);
  for (const l of staticLeases.slice(0, 15)) {
    console.log(" ", l.address, l["mac-address"] || "", "| server:", l.server, "|", (l.comment || "").slice(0, 60));
  }

  const queues = await conn.print("/queue/simple");
  const ipoeQ = queues.filter((q) => /ipoe/i.test(String(q.name || "")));
  console.log("\n=== SIMPLE QUEUES (ipoe*) ===", ipoeQ.length);
  for (const q of ipoeQ.slice(0, 10)) console.log(" ", q.name, q.target, q["max-limit"] || q["rate-limit"] || "");

  const routes = await conn.print("/ip/route");
  const def = routes.find((r) => {
    const dst = String(r.dst || r["dst-address"] || "");
    return dst.startsWith("0.0.0.0") && String(r.inactive || "false") !== "true";
  });
  console.log("\n=== DEFAULT ROUTE / WAN ===");
  if (def) {
    console.log(" ", def.dst || def["dst-address"], "via", def.gateway || def["immediate-gw"], "| iface:", def.interface || "(from gw)");
  } else console.log(" (no default route)");

  const issues = [];
  if (jmIpoeFilter.length < 20) issues.push("Apply IPoE firewall: node deploy/apply-suspend-firewall.mjs --ipoe IPOE-CABDELARIA");
  if (!dhcp.some((d) => String(d.name) === "0NE-DAY")) issues.push('DHCP server "0NE-DAY" not found — create in MikroTik or pick correct name in billing');
  if (!ipoeIfaces.some((i) => String(i.name) === "IPOE-1-DAY")) issues.push('Interface "IPOE-1-DAY" not found');
  for (const c of ipoeCust) {
    if (!c.vlan_iface) issues.push(`Customer #${c.id} ${c.name}: missing DHCP server name`);
    if (!c.mac) issues.push(`Customer #${c.id} ${c.name}: missing MAC`);
    if (!c.static_ip) issues.push(`Customer #${c.id} ${c.name}: missing static IP`);
    if (c.vlan_iface && !dhcp.some((d) => String(d.name) === c.vlan_iface)) {
      issues.push(`Customer #${c.id}: vlan_iface "${c.vlan_iface}" not on router — use 0NE-DAY`);
    }
  }

  console.log("\n=== SUMMARY ===");
  if (issues.length) {
    console.log("ISSUES:");
    issues.forEach((x) => console.log(" •", x));
    process.exit(1);
  }
  console.log("OK — site connected, DHCP 0NE-DAY present, firewall installed, customers configured.");
  try { conn.close?.(); } catch {}
}

main().catch((e) => {
  console.error("FAILED:", e.message || e);
  process.exit(1);
});
