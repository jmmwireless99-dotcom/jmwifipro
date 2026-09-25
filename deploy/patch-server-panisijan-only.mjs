/**
 * Patch server.js — PANISIJAN (router 51) ONLY. Does not change shared kitifi-server.js behavior.
 *
 * Usage on VPS:
 *   cd /opt/jm-billing && node deploy/patch-server-panisijan-only.mjs && systemctl restart jm-billing
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverPath = path.join(ROOT, "server.js");
let src = fs.readFileSync(serverPath, "utf8");

if (src.includes("function panisijanVoucherProfile(")) {
  console.log("server.js already patched for PANISIJAN-only profile.");
  process.exit(0);
}

const helper = `
const PANISIJAN_ROUTER_ID = 51;
function panisijanVoucherProfile(rid, fallback) {
  if (Number(rid) !== PANISIJAN_ROUTER_ID) return fallback;
  return String(Settings.get("kitifi_gen_profile_51", "") || Settings.get("kitifi_default_profile_51", "") || "default").trim();
}

`;

const anchor = "const kitifiFulfillLocks = new Map();";
if (!src.includes(anchor)) throw new Error("kitifiFulfillLocks anchor not found in server.js");
src = src.replace(anchor, anchor + helper);

const buyNeedle = "planId: plan.id, amount, profile: plan.profile || \"KITIFI\", uptime: plan.uptime || plan.time || \"\",";
const buyRepl =
  "planId: plan.id, amount, profile: panisijanVoucherProfile(Number(b.router_id) || kitifiPortalRouterId(b.router_id), plan.profile || \"KITIFI\"), uptime: plan.uptime || plan.time || \"\",";
if (!src.includes(buyNeedle)) throw new Error("KitifiOrders.create profile line not found");
src = src.replace(buyNeedle, buyRepl);

const acNeedle = "const base = { mac, voucher: code, routerId: rid, uptime: order.uptime, profile: order.profile };";
const acRepl =
  "const panProf = panisijanVoucherProfile(rid, order.profile);\n  const base = { mac, voucher: code, routerId: rid, uptime: order.uptime, profile: panProf };";
if (!src.includes(acNeedle)) throw new Error("kitifiTryAutoconnect base line not found");
src = src.replace(acNeedle, acRepl);

const acUrlNeedle = "uptime: order.uptime, profile: order.profile })";
const acUrlRepl = "uptime: order.uptime, profile: panProf })";
if (!src.includes(acUrlNeedle)) throw new Error("kitifiTryAutoconnect connect_url profile lines not found");
src = src.split(acUrlNeedle).join(acUrlRepl);

const fulfillNeedle = "planId: order.plan_id, profile: order.profile, uptime: order.uptime,";
const fulfillRepl = "planId: order.plan_id, profile: panisijanVoucherProfile(rid, order.profile), uptime: order.uptime,";
if (!src.includes(fulfillNeedle)) throw new Error("fulfillKitifiOrder profile line not found");
src = src.replace(fulfillNeedle, fulfillRepl);

const bak = serverPath + ".bak-panisijan-only-" + Date.now();
fs.copyFileSync(serverPath, bak);
fs.writeFileSync(serverPath, src);
console.log("Patched server.js for PANISIJAN router 51 only.");
console.log("Backup:", bak);
