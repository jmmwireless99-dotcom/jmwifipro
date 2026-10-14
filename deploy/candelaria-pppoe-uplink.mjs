/**
 * Candelaria PPPoE (billing router id 50, identity PPPOE-JMPRO-IPOE).
 *
 * Paying clients had a live PPP session and no internet: the only active
 * default route is 20.12.10.1%OSPF, OSPF advertises just 20.12.10.0/30 and
 * 9.9.9.9/32, and there was no srcnat. Pings sourced from 11.11.11.1 and
 * 12.10.10.1 failed; a ping sourced from 20.12.10.2 worked.
 *
 * This adds masquerade for the paying pools out interface OSPF.
 * 50.0.0.0/24 (suspended-pool) is not NATed.
 * The suspend HTTP redirect is moved off the removed VPS 187.77.145.131
 * onto jmestre.tech (124.105.235.44).
 *
 * Run on the VPS: node deploy/candelaria-pppoe-uplink.mjs
 */
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RouterOSAPI } from "../lib/routeros-api.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DB = process.env.BILLING_DB || path.join(ROOT, "billing.db");
const PORTAL_IP = "124.105.235.44";
const OLD_PORTAL_IP = "187.77.145.131";
const NAT_PREFIXES = [
  "11.11.11.0/24",
  "12.10.10.0/24",
  "14.10.10.0/24",
  "15.10.10.0/24",
  "172.30.30.0/24",
  "172.12.9.0/24",
];

const db = new DatabaseSync(DB);
const row = db.prepare("SELECT * FROM routers WHERE id=50").get();
if (!row) {
  console.error("router 50 not found");
  process.exit(1);
}
const conn = new RouterOSAPI({
  host: String(row.host).split(":")[0],
  user: row.username || "",
  password: row.password || "",
  port: Number(row.port) || 8728,
  ssl: !!row.ssl,
  timeout: 25000,
});

function words(attrs) {
  return Object.entries(attrs).filter(([, v]) => v != null && v !== "").map(([k, v]) => `=${k}=${v}`);
}

console.log("identity", (await conn.identity()).name);

const nats = await conn.print("/ip/firewall/nat");
for (const prefix of NAT_PREFIXES) {
  const comment = `JM: NAT ${prefix} via OSPF`;
  if ((nats || []).some((r) => r.comment === comment)) {
    console.log("nat exists", prefix);
    continue;
  }
  await conn.talk(["/ip/firewall/nat/add", ...words({
    chain: "srcnat",
    action: "masquerade",
    "out-interface": "OSPF",
    "src-address": prefix,
    comment,
  })]);
  console.log("nat added", prefix);
}

const natNow = await conn.print("/ip/firewall/nat");
for (const r of natNow || []) {
  if (r["to-addresses"] === OLD_PORTAL_IP || r.comment === "JM suspend:HTTP redirect to portal") {
    if (r["to-addresses"] === PORTAL_IP) continue;
    await conn.talk([
      "/ip/firewall/nat/set",
      "=.id=" + r[".id"],
      "=to-addresses=" + PORTAL_IP,
      "=comment=JM suspend:HTTP redirect to portal",
    ]);
    console.log("portal dst-nat ->", PORTAL_IP);
  }
}

const filters = await conn.print("/ip/firewall/filter");
const reject = (filters || []).find((r) => r.comment === "JM suspend:block internet");
for (const r of filters || []) {
  if (r["dst-address"] === OLD_PORTAL_IP) {
    await conn.talk([
      "/ip/firewall/filter/set",
      "=.id=" + r[".id"],
      "=dst-address=" + PORTAL_IP,
      `=comment=JM suspend:portal ${PORTAL_IP}`,
    ]);
    console.log("portal accept ->", PORTAL_IP);
  }
}
for (const host of ["jmestre.tech", "*.jmestre.tech"]) {
  const comment = `JM suspend:tls ${host}`;
  if ((filters || []).some((r) => r.comment === comment)) {
    console.log("tls exists", host);
    continue;
  }
  const attrs = {
    chain: "forward",
    action: "accept",
    "src-address-list": "suspended",
    protocol: "tcp",
    "dst-port": "443",
    "tls-host": host,
    comment,
  };
  if (reject) attrs["place-before"] = reject[".id"];
  await conn.talk(["/ip/firewall/filter/add", ...words(attrs)]);
  console.log("tls added", host);
}
for (const address of ["jmestre.tech", PORTAL_IP]) {
  const rows = await conn.print("/ip/firewall/address-list", { list: "payment-whitelist", address });
  if (rows && rows.length) {
    console.log("whitelist exists", address);
    continue;
  }
  await conn.addrListAdd("payment-whitelist", address, `JM: ${address}`);
  console.log("whitelist added", address);
}

async function pingSrc(address, src) {
  const rows = await conn.talk(["/ping", "=address=" + address, "=src-address=" + src, "=count=3"]);
  let got = false;
  let maxR = 0;
  for (const r of rows || []) {
    if (r.time) got = true;
    const n = Number(r.received || 0);
    if (n > maxR) maxR = n;
    if (n > 0) got = true;
  }
  console.log("PING", address, "src", src, JSON.stringify({ reachable: got, received: maxR }));
  return got;
}

const pay999 = await pingSrc("8.8.8.8", "11.11.11.1");
const pay1299 = await pingSrc("8.8.8.8", "12.10.10.1");
const susp = await pingSrc("8.8.8.8", "50.0.0.1");
console.log("RESULT", JSON.stringify({ pay999, pay1299, suspendedStillNoReturn: !susp }));
try { conn.close && conn.close(); } catch {}
if (!pay999 || !pay1299 || susp) process.exit(1);
