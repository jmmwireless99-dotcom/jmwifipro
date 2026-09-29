/**
 * Make MAGSAY2X-CORE a jmwifi.pro billing PPPoE server using the same
 * profile / pool / suspend stack as CANDELARIA-PPPOE.
 *
 * On VPS:
 *   cd /opt/jm-billing && node deploy/setup-magsay2x-pppoe.mjs
 *   node deploy/apply-suspend-firewall.mjs MAGSAY2X-CORE PLDT-SEM
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { RouterOSAPI } from "../lib/routeros-api.js";
import {
  REQUIRED_POOLS,
  REQUIRED_PROFILES,
  PPPOE_SERVER,
  displayNameFromSecret,
  shouldImportSecret,
} from "../lib/magsay2x-pppoe.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DB = process.env.BILLING_DB || path.join(ROOT, "billing.db");
const DRY = process.argv.includes("--dry-run");

function connFor(row) {
  return new RouterOSAPI({
    host: String(row.host || "").split(":")[0],
    user: row.username,
    password: row.password,
    port: Number(row.port) || 8728,
    ssl: !!row.ssl,
    timeout: 25000,
  });
}

async function ensurePools(conn) {
  const out = [];
  for (const pool of REQUIRED_POOLS) {
    const id = await conn.findId("/ip/pool", "name", pool.name);
    if (id) {
      out.push({ name: pool.name, action: "exists" });
      continue;
    }
    if (DRY) {
      out.push({ name: pool.name, action: "would-create" });
      continue;
    }
    await conn.add("/ip/pool", {
      name: pool.name,
      ranges: pool.ranges,
      comment: pool.comment || "JM MAGSAY2X PPPoE",
    });
    out.push({ name: pool.name, action: "created" });
  }
  return out;
}

async function ensureProfiles(conn) {
  const out = [];
  for (const p of REQUIRED_PROFILES) {
    const attrs = {
      "local-address": p.local,
      "remote-address": p.remote,
      "rate-limit": p.rate,
      "dns-server": p.dns,
    };
    if (p.list) attrs["address-list"] = p.list;
    const id = await conn.findId("/ppp/profile", "name", p.name);
    if (id) {
      if (!DRY) await conn.setById("/ppp/profile", id, attrs);
      out.push({ name: p.name, action: DRY ? "would-update" : "updated" });
    } else if (DRY) {
      out.push({ name: p.name, action: "would-create" });
    } else {
      await conn.add("/ppp/profile", { name: p.name, ...attrs });
      out.push({ name: p.name, action: "created" });
    }
  }
  return out;
}

async function ensurePppoeServer(conn) {
  const rows = (await conn.print("/interface/pppoe-server/server")) || [];
  const onIface = rows.find((r) => r.interface === PPPOE_SERVER.interface);
  if (onIface) {
    if (String(onIface.disabled) === "true" && !DRY) {
      await conn.setById("/interface/pppoe-server/server", onIface[".id"], { disabled: "false" });
      return { action: "enabled", interface: PPPOE_SERVER.interface, service: onIface["service-name"] };
    }
    return { action: "exists", interface: onIface.interface, service: onIface["service-name"], disabled: onIface.disabled };
  }
  if (DRY) return { action: "would-create", interface: PPPOE_SERVER.interface };
  await conn.add("/interface/pppoe-server/server", PPPOE_SERVER);
  return { action: "created", interface: PPPOE_SERVER.interface, service: PPPOE_SERVER["service-name"] };
}

function pickPlanId(db, profile) {
  const maps = [
    ["Home Fiber 999", "SELECT id FROM plans WHERE router_profile=? OR (name LIKE ? AND price=999) LIMIT 1", ["Home Fiber 999", "%Unli Surf%"]],
    ["Home Fiber 1299", "SELECT id FROM plans WHERE router_profile=? OR (name LIKE ? AND price=1299) LIMIT 1", ["Home Fiber 1299", "%Super Surf%"]],
    ["Enterprise 2499", "SELECT id FROM plans WHERE router_profile=? OR (price=2499 AND type='pppoe') LIMIT 1", ["Enterprise 2499"]],
    ["Enterprise 3800", "SELECT id FROM plans WHERE router_profile=? OR (price=3800 AND type='pppoe') LIMIT 1", ["Enterprise 3800"]],
  ];
  for (const [name, sql, args] of maps) {
    if (profile === name) {
      const row = db.prepare(sql).get(...args);
      if (row) return row.id;
    }
  }
  return db.prepare("SELECT id FROM plans WHERE type='pppoe' ORDER BY id LIMIT 1").get()?.id || 1;
}

function dedupeRouters(db) {
  const rows = db.prepare("SELECT id,enabled,last_status FROM routers WHERE name='MAGSAY2X-CORE' ORDER BY id").all();
  const keep = rows.find((r) => r.id === 53) || rows[0];
  const extras = rows.filter((r) => r.id !== keep.id);
  const moved = [];
  for (const extra of extras) {
    const n = db.prepare("UPDATE customers SET router_id=? WHERE router_id=?").run(keep.id, extra.id).changes;
    if (!DRY) db.prepare("UPDATE routers SET enabled=0, vpn_notes='duplicate of MAGSAY2X-CORE #'||? WHERE id=?").run(keep.id, extra.id);
    moved.push({ from: extra.id, to: keep.id, customers: n });
  }
  db.prepare("UPDATE routers SET area='MAGSAY2X', vpn_notes=?, enabled=1 WHERE id=?").run(
    "PPPoE server for jmwifi.pro billing (same profiles as CANDELARIA-PPPOE)",
    keep.id,
  );
  return { keep: keep.id, extras: moved };
}

function importSecrets(db, routerId, secrets) {
  const existing = new Set(
    db.prepare("SELECT lower(username) u FROM customers WHERE username IS NOT NULL AND username!=''").all().map((r) => r.u),
  );
  const created = [];
  const skipped = [];
  for (const s of secrets || []) {
    if (!shouldImportSecret(s)) {
      skipped.push({ name: s.name, reason: "not-pppoe" });
      continue;
    }
    const user = String(s.name).trim();
    if (existing.has(user.toLowerCase())) {
      skipped.push({ name: user, reason: "already-in-billing" });
      continue;
    }
    const profile = String(s.profile || "Home Fiber 999");
    const planId = pickPlanId(db, profile);
    const status = profile === "suspended-pool" ? "suspended" : "active";
    if (!DRY) {
      db.prepare(
        `INSERT INTO customers (name,username,password,plan_id,router_id,conn_type,status,area,notes)
         VALUES (?,?,?,?,?,?,?,?,?)`,
      ).run(
        displayNameFromSecret(user, profile),
        user,
        s.password || "",
        planId,
        routerId,
        "pppoe",
        status,
        "MAGSAY2X",
        "imported from MAGSAY2X-CORE pppoe · profile " + profile,
      );
    }
    existing.add(user.toLowerCase());
    created.push({ name: user, profile, planId, status });
  }
  return { created, skipped };
}

function fixCandelariaMisassign(db) {
  // ALVIN is live on CANDELARIA-PPPOE, not MAGSAY.
  const row = db.prepare("SELECT id,username,router_id FROM customers WHERE username='ALVIN_MONTEALEGRE'").get();
  if (row && Number(row.router_id) === 53) {
    const cand = db.prepare("SELECT id FROM routers WHERE name='CANDELARIA-PPPOE'").get();
    if (cand && !DRY) db.prepare("UPDATE customers SET router_id=? WHERE id=?").run(cand.id, row.id);
    return { username: row.username, from: 53, to: cand?.id || 50 };
  }
  return null;
}

async function main() {
  const db = new DatabaseSync(DB);
  const row = db.prepare("SELECT * FROM routers WHERE name='MAGSAY2X-CORE' AND enabled=1 ORDER BY id LIMIT 1").get()
    || db.prepare("SELECT * FROM routers WHERE name='MAGSAY2X-CORE' ORDER BY id LIMIT 1").get();
  if (!row) throw new Error("MAGSAY2X-CORE not in routers");

  const conn = connFor(row);
  const ident = await conn.identity();
  console.log("Connected", row.name, "id=" + row.id, "→", ident?.name || ident);

  const pools = await ensurePools(conn);
  const profiles = await ensureProfiles(conn);
  const server = await ensurePppoeServer(conn);
  const secrets = ((await conn.print("/ppp/secret")) || []).filter((s) => String(s.service || "pppoe") === "pppoe");
  const active = ((await conn.print("/ppp/active")) || []).filter((s) => /pppoe/i.test(String(s.service || "pppoe")));
  try { conn.close?.(); } catch {}

  const routers = DRY ? { keep: row.id, extras: [] } : dedupeRouters(db);
  const mis = DRY ? null : fixCandelariaMisassign(db);
  const imported = importSecrets(db, routers.keep || row.id, secrets);

  console.log(JSON.stringify({
    identity: ident?.name || ident,
    pools,
    profiles,
    server,
    pppoeSecrets: secrets.length,
    pppoeActive: active.length,
    routers,
    reassignedToCandelaria: mis,
    imported: { created: imported.created.length, skipped: imported.skipped.length, names: imported.created.map((c) => c.name) },
    dry: DRY,
  }, null, 2));
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  main().catch((e) => {
    console.error(e.message || e);
    process.exit(1);
  });
}
