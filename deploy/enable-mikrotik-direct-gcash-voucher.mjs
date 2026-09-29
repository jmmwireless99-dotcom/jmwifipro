/**
 * GCash BUY VOUCHER creates /ip/hotspot/user on the site MikroTik.
 * Skips KiTifi controller login (fixes 3rd-server "KiTifi login rejected").
 *
 * PayMongo/GCash still goes through jmwifi.pro. The voucher does not.
 *
 * On VPS:
 *   cd /opt/jm-billing && node deploy/enable-mikrotik-direct-gcash-voucher.mjs
 *   systemctl restart jm-billing
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import {
  GCASH_GENERATE_KEY,
  DEFAULT_GCASH_GENERATE,
  hotspotUserAddWords,
  kitifiUptimeToMikrotik,
} from "../lib/kitifi-mikrotik-direct-voucher.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DB = process.env.BILLING_DB || path.join(ROOT, "billing.db");
const SERVER_JS = process.env.KITIFI_SERVER_JS || path.join(ROOT, "lib/kitifi-server.js");
const DRY = process.argv.includes("--dry-run");
const SKIP_RECOVER = process.argv.includes("--skip-recover");
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export const OLD_ONLY = `export function kitifiMikrotikOnlyRouter(routerId) {
  const rid = Number(routerId);
  if (!rid) return false;
  if (String(Settings.get("kitifi_free_mode_" + rid, "") || "").trim().toLowerCase() === "mikrotik") return true;
  const list = String(Settings.get("kitifi_free_mikrotik_routers", "") || "")
    .split(",")
    .map((x) => Number(x.trim()))
    .filter(Boolean);
  return list.includes(rid);
}`;

export const NEW_ONLY = `export function kitifiMikrotikOnlyRouter(routerId) {
  const rid = Number(routerId);
  if (!rid) return false;
  const gcash = String(Settings.get("kitifi_gcash_generate_" + rid, Settings.get("kitifi_gcash_generate", "mikrotik")) || "mikrotik").trim().toLowerCase();
  if (gcash === "mikrotik" || gcash === "direct") return true;
  if (gcash === "kitifi" || gcash === "controller" || gcash === "remote") {
    if (String(Settings.get("kitifi_free_mode_" + rid, "") || "").trim().toLowerCase() === "mikrotik") return true;
    const list = String(Settings.get("kitifi_free_mikrotik_routers", "") || "")
      .split(",")
      .map((x) => Number(x.trim()))
      .filter(Boolean);
    return list.includes(rid);
  }
  if (String(Settings.get("kitifi_free_mode_" + rid, "") || "").trim().toLowerCase() === "mikrotik") return true;
  const list = String(Settings.get("kitifi_free_mikrotik_routers", "") || "")
    .split(",")
    .map((x) => Number(x.trim()))
    .filter(Boolean);
  return list.includes(rid);
}`;

export function patchKitifiServerSource(src) {
  if (!src.includes("export function kitifiMikrotikOnlyRouter")) {
    throw new Error("kitifi-server.js missing kitifiMikrotikOnlyRouter");
  }
  if (src.includes('Settings.get("kitifi_gcash_generate"')) return { src, changed: false };
  if (!src.includes(OLD_ONLY)) {
    throw new Error("kitifiMikrotikOnlyRouter body changed — update the deploy patch");
  }
  return { src: src.replace(OLD_ONLY, NEW_ONLY), changed: true };
}

function genCode(prefix = "VC") {
  let s = String(prefix || "");
  for (let i = 0; i < 5; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return s;
}

function setSetting(db, k, v) {
  db.prepare(
    "INSERT INTO settings (k,v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v",
  ).run(k, v);
}

async function loadRouterOS() {
  const candidates = [
    path.join(ROOT, "lib/routeros-api.js"),
    "/opt/jm-billing/lib/routeros-api.js",
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      const mod = await import(pathToFileURL(p).href);
      return mod.RouterOSAPI;
    }
  }
  throw new Error("routeros-api.js not found");
}

function connFor(RouterOSAPI, row) {
  return new RouterOSAPI({
    host: String(row.host || "").split(":")[0],
    user: row.username,
    password: row.password,
    port: Number(row.port) || 8728,
    ssl: !!row.ssl,
    timeout: 20000,
  });
}

async function addHotspotUser(conn, { code, profile, uptime }) {
  const users = (await conn.print("/ip/hotspot/user")) || [];
  const hit = users.find((u) => String(u.name || "").toUpperCase() === String(code).toUpperCase());
  if (hit) return { existed: true };
  await conn.talk(hotspotUserAddWords({ code, profile, uptime }));
  return { created: true };
}

export async function recoverPaidFailed(db, { RouterOSAPI, dry = false } = {}) {
  const rows = db.prepare(
    `SELECT id, router_id, profile, uptime
     FROM kitifi_orders
     WHERE status='failed' AND paid_at IS NOT NULL AND TRIM(COALESCE(paid_at,''))!=''
       AND TRIM(COALESCE(voucher_code,''))=''
       AND created_at >= datetime('now', '-14 days')
     ORDER BY id`,
  ).all();
  const out = { attempted: rows.length, ready: 0, errors: [] };
  if (!RouterOSAPI) return out;
  const conns = new Map();
  const routerRow = (id) => db.prepare("SELECT * FROM routers WHERE id=?").get(id);

  for (const order of rows) {
    const rid = Number(order.router_id);
    const row = routerRow(rid);
    if (!row) {
      out.errors.push({ id: order.id, error: "router missing" });
      continue;
    }
    try {
      if (!conns.has(rid)) {
        const conn = connFor(RouterOSAPI, row);
        await conn.identity();
        conns.set(rid, conn);
      }
      const conn = conns.get(rid);
      let code = "";
      let ok = false;
      for (let i = 0; i < 8; i++) {
        code = genCode("VC");
        const r = await addHotspotUser(conn, {
          code,
          profile: order.profile || "KITIFI",
          uptime: order.uptime || "10 Hours",
        });
        if (r.created) {
          ok = true;
          break;
        }
      }
      if (!ok) throw new Error("could not allocate hotspot user");
      if (!dry) {
        db.prepare(
          `UPDATE kitifi_orders
           SET status='ready', voucher_code=?, fulfilled_at=datetime('now'),
               gateway_ref=CASE WHEN TRIM(COALESCE(gateway_ref,''))='' THEN payment_intent_id ELSE gateway_ref END
           WHERE id=?`,
        ).run(code, order.id);
      }
      out.ready += 1;
    } catch (e) {
      out.errors.push({ id: order.id, router: rid, error: String(e.message || e).slice(0, 160) });
    }
  }
  for (const conn of conns.values()) {
    try { conn.close?.(); } catch {}
  }
  return out;
}

async function main() {
  const db = new DatabaseSync(DB);
  const serverPath = fs.existsSync(SERVER_JS) ? SERVER_JS : "/opt/jm-billing/lib/kitifi-server.js";
  const before = fs.readFileSync(serverPath, "utf8");
  const patched = patchKitifiServerSource(before);
  if (!DRY && patched.changed) {
    fs.copyFileSync(serverPath, serverPath + ".bak-mikrotik-direct");
    fs.writeFileSync(serverPath, patched.src);
  }
  if (!DRY) setSetting(db, GCASH_GENERATE_KEY, DEFAULT_GCASH_GENERATE);

  let recovered = { skipped: true };
  if (!SKIP_RECOVER) {
    const RouterOSAPI = await loadRouterOS();
    recovered = await recoverPaidFailed(db, { RouterOSAPI, dry: DRY });
  }

  console.log(JSON.stringify({
    serverPath,
    patched: patched.changed,
    gcashGenerate: DEFAULT_GCASH_GENERATE,
    uptimeSample: { "10 Hours": kitifiUptimeToMikrotik("10 Hours"), "15 Hours": kitifiUptimeToMikrotik("15 Hours") },
    recovered,
    dry: DRY,
    next: "systemctl restart jm-billing",
  }, null, 2));
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  main().catch((e) => {
    console.error(e.message || e);
    process.exit(1);
  });
}
