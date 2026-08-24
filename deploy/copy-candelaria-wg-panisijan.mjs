/**
 * Copy Candelaria-kitifi walled garden + ECASH (reminder-allow-site) → PANISIJAN router 51.
 * Same flow as KiTifi sites: GCash/PayMongo via address-list, not blanket HTTPS.
 *
 * Usage: BILLING_DB=/opt/jm-billing/billing.db node deploy/copy-candelaria-wg-panisijan.mjs
 */
import dns from "node:dns/promises";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { RouterOSAPI } from "../lib/routeros-api.js";

const DB = process.env.BILLING_DB || path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "billing.db");
const SOURCE_ID = Number(process.env.SOURCE_ROUTER_ID || 34);
const TARGET_ID = Number(process.env.TARGET_ROUTER_ID || 51);
const KITIFI_IP = "10.0.0.10";
const PORTAL_IP = "187.77.145.131";

function conn(row) {
  return new RouterOSAPI({
    host: String(row.host).split(":")[0],
    user: row.username,
    password: row.password,
    port: Number(row.port) || 8728,
    ssl: !!row.ssl,
    timeout: 120000,
  });
}

async function safeRemove(c, apiPath, id) {
  try {
    await c.talk([apiPath + "/remove", "=.id=" + id]);
    return true;
  } catch {
    return false;
  }
}

async function clearList(c, listName) {
  const rows = (await c.print("/ip/firewall/address-list")).filter((r) => r.list === listName);
  let n = 0;
  for (const r of rows) {
    if (await safeRemove(c, "/ip/firewall/address-list", r[".id"])) n++;
  }
  return n;
}

async function addListEntries(c, listName, addresses, comment = "") {
  let n = 0;
  for (const address of addresses) {
    try {
      const args = ["/ip/firewall/address-list/add", "=list=" + listName, "=address=" + address];
      if (comment) args.push("=comment=" + comment);
      await c.talk(args);
      n++;
    } catch (e) {
      if (!/already have/i.test(String(e.message))) throw e;
    }
  }
  return n;
}

async function removeTargetPaymentRules(c) {
  let n = 0;
  for (const apiPath of ["/ip/hotspot/walled-garden", "/ip/hotspot/walled-garden/ip"]) {
    const rows = await c.print(apiPath);
    for (const r of rows) {
      if (r.dynamic === "true" || r.dynamic === true) continue;
      const cmt = String(r.comment || "");
      if (cmt === "place hotspot rules here") continue;
      if (
        cmt.startsWith("JM") ||
        cmt.includes("GCash") ||
        cmt.includes("PayMongo") ||
        cmt === "KiTifi-Setup" ||
        cmt === "ALLOW LIST FOR ECASH PAYMENT" ||
        cmt.includes("KiTifi portal") ||
        cmt.includes("free register")
      ) {
        if (await safeRemove(c, apiPath, r[".id"])) n++;
      }
    }
  }
  const fw = await c.print("/ip/firewall/filter");
  for (const f of fw) {
    const chain = String(f.chain || "");
    const cmt = String(f.comment || "");
    if (!chain.includes("hs-unauth")) continue;
    if (cmt.startsWith("JM") || cmt.includes("GCash") || cmt.includes("pay:") || cmt.includes("KiTifi") || cmt.includes("ECASH")) {
      if (await safeRemove(c, "/ip/firewall/filter", f[".id"])) n++;
    }
  }
  return n;
}

async function ensureWgHost(c, host, comment, have) {
  const h = String(host || "").trim();
  if (!h || have.has("h:" + h.toLowerCase())) return false;
  const rows = await c.print("/ip/hotspot/walled-garden");
  if (rows.some((x) => String(x["dst-host"] || x["dst-address"] || "").toLowerCase() === h.toLowerCase())) {
    have.add("h:" + h.toLowerCase());
    return false;
  }
  const args = ["/ip/hotspot/walled-garden/add", "=action=allow", "=comment=" + comment];
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) args.push("=dst-address=" + h);
  else args.push("=dst-host=" + h);
  await c.talk(args);
  have.add("h:" + h.toLowerCase());
  return true;
}

async function ensureWgIp(c, opts, have) {
  const key = opts.list ? "l:" + opts.list : "a:" + opts.address;
  if (have.has(key)) return false;
  const rows = await c.print("/ip/hotspot/walled-garden/ip");
  if (opts.list && rows.some((x) => x["dst-address-list"] === opts.list)) {
    have.add(key);
    return false;
  }
  if (opts.address && rows.some((x) => x["dst-address"] === opts.address)) {
    have.add(key);
    return false;
  }
  const args = ["/ip/hotspot/walled-garden/ip/add", "=action=accept", "=comment=" + opts.comment];
  if (opts.list) args.push("=dst-address-list=" + opts.list);
  else args.push("=dst-address=" + opts.address);
  await c.talk(args);
  have.add(key);
  return true;
}

async function ensureFwReturn(c, chain, opts, have) {
  const key = chain + ":" + (opts.comment || opts.list || opts.address);
  if (have.has(key)) return false;
  const fw = await c.print("/ip/firewall/filter");
  if (fw.some((f) => f.chain === chain && f.comment === opts.comment)) {
    have.add(key);
    return false;
  }
  const reject = fw.find((f) => f.chain === chain && (f.action === "reject" || f.action === "drop"));
  const args = ["/ip/firewall/filter/add", "=chain=" + chain, "=action=return", "=comment=" + opts.comment];
  if (opts.address) args.push("=dst-address=" + opts.address);
  if (opts.list) args.push("=dst-address-list=" + opts.list);
  if (reject) args.push("=place-before=" + reject[".id"]);
  await c.talk(args);
  have.add(key);
  return true;
}

async function getHotspotSubnet(c) {
  const hs = await c.print("/ip/hotspot");
  const ifaces = new Set(hs.map((h) => h.interface));
  const subnets = [];
  for (const a of await c.print("/ip/address")) {
    if (!ifaces.has(a.interface)) continue;
    const [addr, bits] = String(a.address).split("/");
    const o = addr.split(".").map(Number);
    subnets.push(`${o[0]}.${o[1]}.${o[2]}.0/${bits || 24}`);
  }
  return [...new Set(subnets)];
}

const db = new DatabaseSync(DB);
const srcRow = db.prepare("SELECT * FROM routers WHERE id=?").get(SOURCE_ID);
const tgtRow = db.prepare("SELECT * FROM routers WHERE id=?").get(TARGET_ID);
if (!srcRow || !tgtRow) throw new Error("Source or target router not found");

const src = conn(srcRow);
const tgt = conn(tgtRow);

console.log("Source:", srcRow.name, "—", (await src.identity()).name);
console.log("Target:", tgtRow.name, "—", (await tgt.identity()).name);

const srcLists = await src.print("/ip/firewall/address-list");
const reminderEntries = srcLists.filter((r) => r.list === "reminder-allow-site").map((r) => r.address);
console.log("\nCandelaria reminder-allow-site:", reminderEntries.length, "entries");

const srcWg = await src.print("/ip/hotspot/walled-garden");
const srcWgi = await src.print("/ip/hotspot/walled-garden/ip");
const srcFw = await src.print("/ip/firewall/filter");

const wgHosts = srcWg
  .filter((w) => !w.dynamic || w.dynamic === "false")
  .map((w) => ({ host: w["dst-host"] || w["dst-address"], comment: w.comment || "KiTifi portal" }))
  .filter((w) => w.host && w.host !== "place hotspot rules here");

const wgIps = srcWgi
  .filter((w) => !w.dynamic || w.dynamic === "false")
  .filter((w) => w["dst-address"] && w["dst-address-list"] !== "reminder-allow-site")
  .map((w) => ({ address: w["dst-address"], comment: w.comment || "JM GCash 4rth" }));

const fwReturns = srcFw.filter(
  (f) =>
    (f.chain === "hs-unauth" || f.chain === "hs-unauth-to") &&
    f.action === "return" &&
    String(f.comment || "").length > 0
);

console.log("\n=== Clean PANISIJAN old payment rules ===");
console.log("  removed entries:", await removeTargetPaymentRules(tgt));
console.log("  jm-gcash cleared:", await clearList(tgt, "jm-gcash"));
console.log("  reminder-allow-site cleared:", await clearList(tgt, "reminder-allow-site"));
console.log("  KiTifi-IP cleared:", await clearList(tgt, "KiTifi-IP"));

console.log("\n=== Copy reminder-allow-site (ECASH list) ===");
console.log("  added:", await addListEntries(tgt, "reminder-allow-site", reminderEntries, "Candelaria copy"));

const tgtSubnets = await getHotspotSubnet(tgt);
console.log("\n=== KiTifi-IP subnets on PANISIJAN ===", tgtSubnets.join(", "));
console.log("  added:", await addListEntries(tgt, "KiTifi-IP", tgtSubnets.length ? tgtSubnets : ["10.0.0.0/24"], "KiTifi-Setup"));

console.log("\n=== Walled garden hosts (from Candelaria) ===");
const haveWg = new Set();
let wgAdded = 0;
for (const w of wgHosts) {
  if (await ensureWgHost(tgt, w.host, w.comment, haveWg)) {
    wgAdded++;
    if (wgAdded <= 10) console.log("  + host", w.host);
  }
}
if (!haveWg.has("h:jmwifi.pro")) {
  await ensureWgHost(tgt, "jmwifi.pro", "KiTifi portal", haveWg);
  await ensureWgHost(tgt, "www.jmwifi.pro", "KiTifi portal", haveWg);
  wgAdded += 2;
}
console.log("  hosts added:", wgAdded);

console.log("\n=== Walled garden IP (Candelaria pattern) ===");
const haveWgi = new Set();
let wgiAdded = 0;
if (await ensureWgIp(tgt, { address: KITIFI_IP, comment: "KiTifi-Setup" }, haveWgi)) {
  console.log("  + ip", KITIFI_IP, "KiTifi-Setup");
  wgiAdded++;
}
if (await ensureWgIp(tgt, { list: "reminder-allow-site", comment: "ALLOW LIST FOR ECASH PAYMENT" }, haveWgi)) {
  console.log("  + ip list reminder-allow-site (ECASH)");
  wgiAdded++;
}
for (const w of wgIps) {
  if (w.address === KITIFI_IP) continue;
  if (await ensureWgIp(tgt, { address: w.address, comment: w.comment }, haveWgi)) wgiAdded++;
}
if (await ensureWgIp(tgt, { address: PORTAL_IP, comment: "JM KiTifi portal" }, haveWgi)) wgiAdded++;
console.log("  ips added:", wgiAdded);

console.log("\n=== Firewall hs-unauth (Candelaria pattern) ===");
const haveFw = new Set();
let fwAdded = 0;
for (const f of fwReturns) {
  const opts = { comment: f.comment };
  if (f["dst-address"]) opts.address = f["dst-address"];
  if (f["dst-address-list"]) opts.list = f["dst-address-list"];
  if (await ensureFwReturn(tgt, f.chain, opts, haveFw)) fwAdded++;
}
if (await ensureFwReturn(tgt, "hs-unauth", { address: PORTAL_IP, comment: "JM KiTifi portal" }, haveFw)) fwAdded++;

const fwNow = await tgt.print("/ip/firewall/filter");
if (!fwNow.some((f) => f.chain === "hs-unauth" && f.action === "reject" && f.protocol === "tcp")) {
  await tgt.talk(["/ip/firewall/filter/add", "=chain=hs-unauth", "=action=reject", "=protocol=tcp"]);
  fwAdded++;
}
if (!fwNow.some((f) => f.chain === "hs-unauth" && f.action === "reject" && !f.protocol)) {
  await tgt.talk(["/ip/firewall/filter/add", "=chain=hs-unauth", "=action=reject"]);
  fwAdded++;
}
if (!fwNow.some((f) => f.chain === "hs-unauth-to" && f.action === "reject")) {
  await tgt.talk(["/ip/firewall/filter/add", "=chain=hs-unauth-to", "=action=reject"]);
  fwAdded++;
}
console.log("  firewall rules added:", fwAdded);

console.log("\n=== Verify PANISIJAN ===");
const vLists = await tgt.print("/ip/firewall/address-list");
console.log("  reminder-allow-site:", vLists.filter((r) => r.list === "reminder-allow-site").length);
console.log("  KiTifi-IP:", vLists.filter((r) => r.list === "KiTifi-IP").length);
const vWg = await tgt.print("/ip/hotspot/walled-garden");
const vWgi = await tgt.print("/ip/hotspot/walled-garden/ip");
console.log("  walled-garden hosts:", vWg.length, "| ips:", vWgi.length);
console.log(
  "  ECASH list in WG ip:",
  vWgi.some((w) => w["dst-address-list"] === "reminder-allow-site") ? "YES" : "NO"
);

src.close?.();
tgt.close?.();
console.log("\nDone — PANISIJAN walled garden matches Candelaria-kitifi ECASH flow.");
