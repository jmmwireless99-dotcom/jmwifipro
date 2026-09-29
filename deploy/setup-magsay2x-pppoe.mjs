/**
 * Copy CANDELARIA-PPPOE expire/GCash firewall flow onto MAGSAY2X-CORE.
 * MAGSAY is a separate site — do not duplicate the router or copy Candelaria clients.
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
  MAGSAY_DUP_NAME,
  CANDELARIA_ROUTER_NAME,
  displayNameFromSecret,
  shouldImportSecret,
  promoProfileFromRos,
  assignmentForMagsaySecret,
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

function pickPlanId(db, profile, username) {
  const promo = promoProfileFromRos(profile, username);
  const maps = [
    ["Home Fiber 999", "SELECT id FROM plans WHERE router_profile=? OR (name LIKE ? AND price=999) LIMIT 1", ["Home Fiber 999", "%Unli Surf%"]],
    ["Home Fiber 1299", "SELECT id FROM plans WHERE router_profile=? OR (name LIKE ? AND price=1299) LIMIT 1", ["Home Fiber 1299", "%Super Surf%"]],
    ["Enterprise 2499", "SELECT id FROM plans WHERE router_profile=? OR (price=2499 AND type='pppoe') LIMIT 1", ["Enterprise 2499"]],
    ["Enterprise 3800", "SELECT id FROM plans WHERE router_profile=? OR (price=3800 AND type='pppoe') LIMIT 1", ["Enterprise 3800"]],
  ];
  for (const [name, sql, args] of maps) {
    if (promo === name) {
      const row = db.prepare(sql).get(...args);
      if (row) return row.id;
    }
  }
  return db.prepare("SELECT id FROM plans WHERE type='pppoe' ORDER BY id LIMIT 1").get()?.id || 1;
}

function disableDuplicateRouter(db, keepId) {
  const rows = db.prepare("SELECT id,enabled FROM routers WHERE name='MAGSAY2X-CORE' OR name=? ORDER BY id").all(MAGSAY_DUP_NAME);
  const keep = rows.find((r) => r.id === keepId) || rows[0];
  const extras = rows.filter((r) => r.id !== keep.id);
  const renamed = [];
  for (const extra of extras) {
    if (!DRY) {
      db.prepare(
        "UPDATE routers SET name=?, enabled=0, area='MAGSAY2X-DISABLED', vpn_notes=? WHERE id=?",
      ).run(
        MAGSAY_DUP_NAME,
        "disabled duplicate — MAGSAY2X site is router #" + keep.id + " (do not copy Candelaria clients here)",
        extra.id,
      );
    }
    renamed.push({ id: extra.id, name: MAGSAY_DUP_NAME });
  }
  if (!DRY) {
    db.prepare("UPDATE routers SET name='MAGSAY2X-CORE', area='MAGSAY2X', vpn_notes=?, enabled=1 WHERE id=?").run(
      "MAGSAY2X site — expire/GCash flow copied from CANDELARIA-PPPOE; own PPPoE clients only",
      keep.id,
    );
  }
  return { keep: keep.id, renamed };
}

function integrateMagsayClients(db, { magRouterId, candRouterId, secrets, magActive, candActive }) {
  const magLive = new Set(magActive || []);
  const candLive = new Set(candActive || []);
  const created = [];
  const updated = [];
  const restored = [];
  const skipped = [];

  for (const s of secrets || []) {
    if (!shouldImportSecret(s)) {
      skipped.push({ name: s.name, reason: "not-pppoe" });
      continue;
    }
    const user = String(s.name).trim();
    const billed = db.prepare("SELECT id,username,router_id,status,plan_id FROM customers WHERE lower(username)=lower(?)").get(user);
    const asg = assignmentForMagsaySecret({
      username: user,
      profile: s.profile,
      magActive: magLive.has(user),
      candActive: candLive.has(user),
      billedRouterId: billed?.router_id,
      magRouterId,
      candRouterId,
    });

    if (asg.action === "skip-candelaria") {
      skipped.push({ name: user, reason: "candelaria-live" });
      continue;
    }
    if (asg.action === "restore-candelaria") {
      if (!DRY && billed && candRouterId) {
        db.prepare("UPDATE customers SET router_id=? WHERE id=?").run(candRouterId, billed.id);
      }
      restored.push({ name: user, from: magRouterId, to: candRouterId });
      continue;
    }

    const planId = pickPlanId(db, s.profile, user);
    const status = asg.status || billed?.status || "active";
    if (!billed) {
      if (!DRY) {
        db.prepare(
          `INSERT INTO customers (name,username,password,plan_id,router_id,conn_type,status,area,notes)
           VALUES (?,?,?,?,?,?,?,?,?)`,
        ).run(
          displayNameFromSecret(user, asg.promoProfile),
          user,
          s.password || "",
          planId,
          magRouterId,
          "pppoe",
          status,
          "MAGSAY2X",
          "MAGSAY2X PPPoE · promo " + asg.promoProfile,
        );
      }
      created.push({ name: user, profile: asg.promoProfile, planId, status });
      continue;
    }

    if (!DRY) {
      if (asg.status) {
        db.prepare(
          `UPDATE customers SET router_id=?, plan_id=?, conn_type='pppoe', status=? WHERE id=?`,
        ).run(magRouterId, planId, asg.status, billed.id);
      } else {
        db.prepare(
          `UPDATE customers SET router_id=?, plan_id=?, conn_type='pppoe' WHERE id=?`,
        ).run(magRouterId, planId, billed.id);
      }
    }
    updated.push({
      name: user,
      from: billed.router_id,
      to: magRouterId,
      planId,
      promoProfile: asg.promoProfile,
      status,
    });
  }

  return { created, updated, restored, skipped };
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

  const candRow = db.prepare("SELECT * FROM routers WHERE name=? AND enabled=1 ORDER BY id LIMIT 1").get(CANDELARIA_ROUTER_NAME);
  let candActive = [];
  if (candRow) {
    const candConn = connFor(candRow);
    try {
      candActive = ((await candConn.print("/ppp/active")) || [])
        .filter((s) => /pppoe/i.test(String(s.service || "pppoe")))
        .map((s) => String(s.name || "").trim())
        .filter(Boolean);
    } finally {
      try { candConn.close?.(); } catch {}
    }
  }

  const routers = DRY ? { keep: row.id, renamed: [] } : disableDuplicateRouter(db, row.id);
  const magActive = active.map((s) => String(s.name || "").trim()).filter(Boolean);
  const integrated = DRY
    ? { created: [], updated: [], restored: [], skipped: [] }
    : integrateMagsayClients(db, {
        magRouterId: routers.keep || row.id,
        candRouterId: candRow?.id || null,
        secrets,
        magActive,
        candActive,
      });

  console.log(JSON.stringify({
    identity: ident?.name || ident,
    pools,
    profiles,
    server,
    pppoeSecrets: secrets.length,
    pppoeActive: active.length,
    candPppoeActive: candActive.length,
    routers,
    integrated: {
      created: integrated.created.length,
      updated: integrated.updated.length,
      restoredToCandelaria: integrated.restored.map((r) => r.name),
      skippedCandelariaLive: integrated.skipped.filter((s) => s.reason === "candelaria-live").map((s) => s.name),
      createdNames: integrated.created.map((c) => c.name),
    },
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
