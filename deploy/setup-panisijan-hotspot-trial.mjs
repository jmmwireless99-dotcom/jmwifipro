/**
 * PANISIJAN (router 51): free internet = MikroTik hotspot trial.
 * No VPS register/claim. Paid ONE DAY INTERNET still goes to jmwifi.pro.
 *
 * On VPS:
 *   cd /opt/jm-billing && node deploy/setup-panisijan-hotspot-trial.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { RouterOSAPI } from "../lib/routeros-api.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DB = process.env.BILLING_DB || path.join(ROOT, "billing.db");
const ROUTER_ID = Number(process.env.ROUTER_ID || 51);
const LOGIN_FILE = "flash/hotspot/login.html";
const HS_GW = "10.0.0.1";
const TRIAL_UPTIME = process.env.TRIAL_UPTIME || "5h";
const RESET_SCRIPT_NAME = "panisijan-reset-trials";
const RESET_SCRIPT = [
  "/ip hotspot user remove [find where name~\"^T-\"]",
  "/ip hotspot cookie remove [find where user~\"^T-\"]",
].join("\r\n");

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

function upsertSetting(k, v) {
  db.prepare("INSERT INTO settings (k,v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").run(k, String(v));
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

async function ensureFreeProfile(conn) {
  const profiles = await conn.print("/ip/hotspot/user/profile");
  let free = (profiles || []).find((p) => p.name === "FREE");
  if (!free) {
    await conn.talk([
      "/ip/hotspot/user/profile/add",
      "=name=FREE",
      "=shared-users=1",
      "=add-mac-cookie=yes",
      "=mac-cookie-timeout=1d",
    ]);
    console.log("  created hotspot user profile FREE");
  } else {
    console.log("  hotspot user profile FREE exists");
  }
}

async function enableTrial(conn) {
  const prof = await conn.print("/ip/hotspot/profile");
  for (const p of prof) {
    const args = [
      "/ip/hotspot/profile/set",
      "=.id=" + p[".id"],
      "=hotspot-address=" + HS_GW,
      "=html-directory=flash/hotspot",
      "=trial-uptime=" + TRIAL_UPTIME,
    ];
    try {
      await conn.talk([...args, "=trial-user-profile=FREE"]);
      console.log("  profile", p.name, "trial-uptime=" + TRIAL_UPTIME, "trial-user-profile=FREE");
    } catch (e) {
      await conn.talk(args);
      console.log("  profile", p.name, "trial-uptime=" + TRIAL_UPTIME, "(no trial-user-profile:", e.message + ")");
    }
  }
}

async function ensureDailyReset(conn) {
  const scripts = await conn.print("/system/script");
  const existingScript = (scripts || []).find((s) => s.name === RESET_SCRIPT_NAME);
  if (existingScript) {
    await conn.talk(["/system/script/set", "=.id=" + existingScript[".id"], "=source=" + RESET_SCRIPT]);
    console.log("  updated script", RESET_SCRIPT_NAME);
  } else {
    await conn.talk([
      "/system/script/add",
      "=name=" + RESET_SCRIPT_NAME,
      "=source=" + RESET_SCRIPT,
    ]);
    console.log("  added script", RESET_SCRIPT_NAME);
  }

  const sched = await conn.print("/system/scheduler");
  const existingSched = (sched || []).find((s) => s.name === RESET_SCRIPT_NAME);
  const schedArgs = [
    "=interval=1d",
    "=start-time=00:05:00",
    "=on-event=" + RESET_SCRIPT_NAME,
    "=comment=Reset PANISIJAN hotspot trial users daily",
  ];
  if (existingSched) {
    await conn.talk(["/system/scheduler/set", "=.id=" + existingSched[".id"], ...schedArgs]);
    console.log("  updated scheduler", RESET_SCRIPT_NAME, "00:05 daily");
  } else {
    await conn.talk(["/system/scheduler/add", "=name=" + RESET_SCRIPT_NAME, ...schedArgs]);
    console.log("  added scheduler", RESET_SCRIPT_NAME, "00:05 daily");
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

console.log("=== PANISIJAN hotspot trial setup (router", ROUTER_ID + ") ===");

const loginPath = path.join(ROOT, "public", "hotspot", "panisijan-login.html");
if (!fs.existsSync(loginPath)) throw new Error("Missing " + loginPath);
const loginHtml = fs.readFileSync(loginPath, "utf8");
if (!loginHtml.includes("username=T-$(mac-esc)")) {
  throw new Error("login HTML is missing MikroTik trial username=T-$(mac-esc)");
}
if (loginHtml.includes("/kitifi/free-internet")) {
  throw new Error("login HTML still sends free internet to the VPS form");
}

upsertSetting("kitifi_free_mode_" + ROUTER_ID, "hotspot-trial");
upsertSetting("kitifi_free_skip_register_" + ROUTER_ID, "1");
upsertSetting("kitifi_free_hours", "5");
upsertSetting("kitifi_free_limit_per_day_" + ROUTER_ID, "1");
upsertSetting("kitifi_hotspot_login_" + ROUTER_ID, "http://" + HS_GW + "/login");
console.log("Billing settings: kitifi_free_mode_51=hotspot-trial");

const conn = connFor(row);
await conn.ensureConnected();
console.log("Connected:", row.name, "—", (await conn.identity()).name);

console.log("\n=== User profile ===");
await ensureFreeProfile(conn);

console.log("\n=== Enable hotspot trial ===");
await enableTrial(conn);

console.log("\n=== Daily trial reset ===");
await ensureDailyReset(conn);

console.log("\n=== Upload login page ===");
const action = await setFile(conn, LOGIN_FILE, loginHtml);
console.log(" ", action, LOGIN_FILE, "(" + loginHtml.length + " bytes)");

console.log("\n=== Restart hotspot ===");
await restartHotspot(conn);

conn.close?.();
console.log("\nDone.");
console.log("Flow: connect SSID -> CLAIM FREE INTERNET (MikroTik trial T-MAC, 5h)");
console.log("Paid: ONE DAY INTERNET still opens jmwifi.pro GCash.");
console.log("Copy public/kitifi/free-internet.html to the VPS so old links bounce to trial.");
