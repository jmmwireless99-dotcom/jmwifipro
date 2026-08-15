/**
 * PANISIJAN (router 51) — fix GCash voucher profile + retry failed paid orders + auto-connect.
 *
 * Root cause: plans use profile KITIFI but MikroTik only has default/FREE → voucher gen fails after pay.
 *
 * Usage on VPS:
 *   cd /opt/jm-billing
 *   git pull   # get lib/kitifi-server.js with kitifiPaidHotspotProfile
 *   node deploy/fix-panisijan-voucher-profile.mjs
 *   systemctl restart jm-billing
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { RouterOSAPI } from "../lib/routeros-api.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DB = process.env.BILLING_DB || path.join(ROOT, "billing.db");
const ROUTER_ID = Number(process.env.ROUTER_ID || 51);
const RETRY_TOKEN = String(process.env.RETRY_TOKEN || "").trim();

const db = new DatabaseSync(DB);

function upsertSetting(k, v) {
  db.prepare("INSERT INTO settings (k,v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").run(k, String(v));
}

function fixPlansInSettings() {
  const key = "kitifi_plans_" + ROUTER_ID;
  const row = db.prepare("SELECT v FROM settings WHERE k=?").get(key);
  if (!row?.v) {
    console.log("  no", key, "— skipping plan profile patch");
    return 0;
  }
  let plans;
  try {
    plans = JSON.parse(row.v);
  } catch (e) {
    console.log("  could not parse", key, ":", e.message);
    return 0;
  }
  if (!Array.isArray(plans)) return 0;
  let n = 0;
  for (const p of plans) {
    if (String(p.profile || "").toUpperCase() === "KITIFI" || !p.profile) {
      p.profile = "default";
      n++;
    }
  }
  upsertSetting(key, JSON.stringify(plans));
  console.log("  updated", n, "plan profile(s) in", key);
  return n;
}

function patchServerJs() {
  const serverPath = path.join(ROOT, "server.js");
  if (!fs.existsSync(serverPath)) {
    console.log("  server.js not found — skip inline patch (lib/kitifi-server.js fix is enough if imported)");
    return;
  }
  let src = fs.readFileSync(serverPath, "utf8");
  const marker = "kitifiPaidHotspotProfile";
  if (src.includes(marker)) {
    console.log("  server.js already references kitifiPaidHotspotProfile");
    return;
  }

  const oldProf =
    'const prof = String(profile || p.profile || Settings.get("kitifi_gen_profile_" + rid, "") || kitifiGenProfile(rid) || "default").trim();';
  const newProf = "const prof = kitifiPaidHotspotProfile(rid, profile || p.profile);";
  if (src.includes(oldProf)) {
    src = src.replace(oldProf, newProf);
    if (!/kitifiPaidHotspotProfile/.test(src.split("kitifiMikrotikGenerateVoucher")[0] || "")) {
      src = src.replace(
        /(import \{[^}]*)(} from "\.\/lib\/kitifi-server\.js";)/,
        (m, a, b) => (a.includes("kitifiPaidHotspotProfile") ? m : a + ", kitifiPaidHotspotProfile" + b)
      );
    }
    fs.writeFileSync(serverPath, src);
    console.log("  patched server.js kitifiMikrotikGenerateVoucher profile line");
    return;
  }

  const orderProf = "profile: plan.profile || kitifiDefaultProfile()";
  if (src.includes(orderProf)) {
    src = src.replace(
      orderProf,
      "profile: kitifiPaidHotspotProfile(Number(order.router_id), plan.profile)"
    );
    fs.writeFileSync(serverPath, src);
    console.log("  patched server.js order profile assignment");
    return;
  }

  console.log("  server.js: no known profile pattern — rely on lib/kitifi-server.js import");
}

function connFor(row) {
  return new RouterOSAPI({
    host: String(row.host).split(":")[0],
    user: row.username,
    password: row.password,
    port: Number(row.port) || 8728,
    ssl: !!row.ssl,
    timeout: 120000,
  });
}

function findFailedPaidOrders() {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
  const candidates = tables.filter((t) => /kitifi/i.test(t) && /order/i.test(t));
  const out = [];
  for (const table of candidates) {
    const cols = db.prepare("PRAGMA table_info(" + table + ")").all().map((c) => c.name);
    if (!cols.includes("status") || !cols.includes("token")) continue;
    const ridCol = cols.includes("router_id") ? "router_id" : cols.includes("routerId") ? "routerId" : null;
    let sql =
      "SELECT * FROM " +
      table +
      " WHERE status='failed' AND paid_at IS NOT NULL AND paid_at != '' AND (voucher_code IS NULL OR voucher_code='')";
    if (ridCol) sql += " AND " + ridCol + "=" + ROUTER_ID;
    if (RETRY_TOKEN) sql = "SELECT * FROM " + table + " WHERE token=" + JSON.stringify(RETRY_TOKEN);
    try {
      const rows = db.prepare(sql).all();
      for (const r of rows) out.push({ table, row: r, cols });
    } catch (e) {
      console.log("  query warn", table, e.message);
    }
  }
  return out;
}

function markOrderReady(table, cols, id, voucherCode) {
  const sets = ["status='ready'", "voucher_code=?"];
  const args = [voucherCode];
  if (cols.includes("profile")) {
    sets.push("profile='default'");
  }
  if (cols.includes("updated_at")) sets.push("updated_at=datetime('now')");
  args.push(id);
  const idCol = cols.includes("id") ? "id" : cols[0];
  db.prepare("UPDATE " + table + " SET " + sets.join(", ") + " WHERE " + idCol + "=?").run(...args);
}

async function retryFailedOrders() {
  const { Settings } = await import("../lib/db.js");
  const { kitifiPlanById } = await import("../lib/kitifi-vouchers.js");
  const {
    kitifiMikrotikGenerateVoucher,
    kitifiMikrotikVoucherConnect,
    kitifiPaidHotspotProfile,
    kitifiConnectUrl,
  } = await import("../lib/kitifi-server.js");

  const routerRow = db.prepare("SELECT * FROM routers WHERE id=?").get(ROUTER_ID);
  if (!routerRow) throw new Error("Router " + ROUTER_ID + " not found");

  const orders = findFailedPaidOrders();
  if (!orders.length) {
    console.log("\nNo failed paid orders to retry.");
    return;
  }

  console.log("\n=== Retry failed paid orders (" + orders.length + ") ===");
  const conn = connFor(routerRow);
  await conn.ensureConnected();
  console.log("Connected:", (await conn.identity()).name);

  for (const { table, row, cols } of orders) {
    const token = row.token || row.gateway_ref || row.id;
    const mac = String(row.client_mac || row.clientMac || row.mac || "").trim();
    const planId = row.plan_id || row.planId;
    const plan = kitifiPlanById(planId, ROUTER_ID) || {};
    console.log("\nOrder", token, "MAC", mac || "(none)", "plan", planId);

    try {
      const gen = await kitifiMikrotikGenerateVoucher(conn, {
        plan,
        routerId: ROUTER_ID,
        profile: kitifiPaidHotspotProfile(ROUTER_ID, plan.profile),
        uptime: plan.uptime || plan.time || row.uptime,
      });
      const code = gen.code;
      markOrderReady(table, cols, row.id, code);
      console.log("  voucher generated:", code, "profile:", gen.profile);

      if (mac && mac.length >= 11) {
        const ac = await kitifiMikrotikVoucherConnect(conn, {
          mac,
          voucher: code,
          routerId: ROUTER_ID,
          uptime: plan.uptime || plan.time,
          profile: gen.profile,
        });
        console.log("  auto-connect:", ac.ok ? "OK" : ac.reason || "failed", ac.via || "");
        if (ac.connect_url) console.log("  connect_url:", ac.connect_url);
      } else {
        console.log("  no MAC — user must redeem via /api/kitifi/redeem?token=" + token);
        console.log("  connect_url:", kitifiConnectUrl(code, ROUTER_ID, mac));
      }
    } catch (e) {
      console.error("  retry failed:", e.message || e);
    }
  }

  conn.close?.();
}

console.log("=== PANISIJAN voucher profile fix (router", ROUTER_ID + ") ===\n");

console.log("=== Settings ===");
upsertSetting("kitifi_gen_profile_" + ROUTER_ID, "default");
upsertSetting("kitifi_default_profile_" + ROUTER_ID, "default");
upsertSetting("kitifi_free_mode_" + ROUTER_ID, "mikrotik");
console.log("  kitifi_gen_profile_" + ROUTER_ID + "=default");
console.log("  kitifi_default_profile_" + ROUTER_ID + "=default");

console.log("\n=== Plan profiles in DB ===");
fixPlansInSettings();

console.log("\n=== server.js patch (if needed) ===");
patchServerJs();

await retryFailedOrders();

console.log("\nDone. Restart: systemctl restart jm-billing");
console.log("User can also open: https://jmwifi.pro/api/kitifi/redeem?token=<token>");
