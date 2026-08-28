/**
 * Restore PANISIJAN captive portal (login popup) while keeping GCash payment access.
 * Removes blanket "HTTPS all" hs-unauth rules that make phones think WiFi has full internet.
 * Re-uploads panisijan-login.html and restarts hotspot.
 *
 * Usage: cd /opt/jm-billing && node deploy/fix-panisijan-captive-portal.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { RouterOSAPI } from "../lib/routeros-api.js";

const ROUTER_ID = Number(process.env.ROUTER_ID || 51);
const DB = process.env.BILLING_DB || path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "billing.db");
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LOGIN_FILE = "flash/hotspot/login.html";
const HS_GW = "10.0.0.1";

const db = new DatabaseSync(DB);
const row = db.prepare("SELECT * FROM routers WHERE id=?").get(ROUTER_ID);
if (!row) throw new Error("Router " + ROUTER_ID + " not found");

function connFor(r) {
  return new RouterOSAPI({
    host: String(r.host).split(":")[0],
    user: r.username,
    password: r.password,
    port: Number(r.port) || 8728,
    ssl: !!r.ssl,
    timeout: 90000,
  });
}

async function setFile(c, name, contents) {
  const files = await c.print("/file");
  const f = files.find((x) => x.name === name);
  if (f) {
    await c.talk(["/file/set", "=.id=" + f[".id"], "=contents=" + contents]);
    return "set";
  }
  await c.talk(["/file/add", "=name=" + name, "=contents=" + contents]);
  return "add";
}

async function removeBroadHttpsRules(conn) {
  const chains = ["hs-unauth", "hs-unauth-to"];
  let n = 0;
  for (const chain of chains) {
    const fw = await conn.print("/ip/firewall/filter");
    for (const f of fw) {
      if (f.chain !== chain) continue;
      const c = String(f.comment || "");
      if (c === "JM pay: HTTPS all" || c === "JM pay: HTTP") {
        try {
          await conn.talk(["/ip/firewall/filter/remove", "=.id=" + f[".id"]]);
          console.log("  removed", chain, c);
          n++;
        } catch {}
      }
    }
  }
  return n;
}

async function ensureHotspotProfile(conn) {
  const prof = await conn.print("/ip/hotspot/profile");
  for (const p of prof) {
    const patch = {};
    if (p["hotspot-address"] !== HS_GW) patch["hotspot-address"] = HS_GW;
    if (p["html-directory"] !== "flash/hotspot") patch["html-directory"] = "flash/hotspot";
    if (Object.keys(patch).length) {
      const args = ["/ip/hotspot/profile/set", "=.id=" + p[".id"]];
      for (const [k, v] of Object.entries(patch)) args.push("=" + k + "=" + v);
      await conn.talk(args);
      console.log("  profile", p.name, "updated", patch);
    }
  }
}

async function restartHotspot(conn) {
  const hs = await conn.print("/ip/hotspot");
  for (const h of hs) {
    await conn.talk(["/ip/hotspot/disable", "=.id=" + h[".id"]]);
    await conn.talk(["/ip/hotspot/enable", "=.id=" + h[".id"]]);
    console.log("  restarted hotspot", h.name);
  }
}

console.log("=== Restore PANISIJAN captive portal (router", ROUTER_ID + ") ===");

const loginPath = path.join(ROOT, "public", "hotspot", "panisijan-login.html");
if (!fs.existsSync(loginPath)) throw new Error("Missing " + loginPath);
const loginHtml = fs.readFileSync(loginPath, "utf8");

const conn = connFor(row);
await conn.ensureConnected();
console.log("Connected:", (await conn.identity()).name);

console.log("\n=== Remove blanket HTTPS (fixes missing captive popup) ===");
const removed = await removeBroadHttpsRules(conn);
console.log("Removed", removed, "broad rule(s). GCash still via jm-gcash address-list.");

console.log("\n=== Hotspot profile ===");
await ensureHotspotProfile(conn);

console.log("\n=== Upload login page ===");
const action = await setFile(conn, LOGIN_FILE, loginHtml);
console.log(" ", action, LOGIN_FILE, "(" + loginHtml.length + " bytes)");

// Remove wrong kitifi login fetch target if present
const files = await conn.print("/file");
const wrong = files.find((f) => f.name === "hotspot/login.html" && Number(f.size) < 500);
if (wrong) {
  try {
    await conn.talk(["/file/remove", "=.id=" + wrong[".id"]]);
    console.log("  removed stray hotspot/login.html stub");
  } catch {}
}

console.log("\n=== Restart hotspot ===");
await restartHotspot(conn);

conn.close?.();
console.log("\nDone. Connect WiFi → captive portal (Register + Buy Voucher) should pop up.");
console.log("GCash app still works via jm-gcash firewall list + walled garden.");
