/**
 * Clone CANDELARIA-PPPOE (PPPoE stack) onto MAGSAYSAY-PPPOE.
 *
 * Copies: IP pools, PPP profiles, PPPoE-server auth knobs, speedtest mangle.
 * Skips: /ppp/secret (per operator request).
 * Target PPPoE server interface: bridge-OUT (customer side).
 * Do NOT apply this to MAGSAY2X-CORE — that site keeps its own live pools.
 *
 * Usage on VPS:
 *   BILLING_DB=/opt/jm-billing/billing.db node deploy/clone-candelaria-pppoe-to-magsay.mjs
 *   node deploy/apply-suspend-firewall.mjs MAGSAYSAY-PPPOE sfp-sfpplus1
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import {
  POOL_NAMES as POOL_NAME_LIST,
  PROFILE_NAMES as PROFILE_NAME_LIST,
  MAG_PPPOE_IFACE as MAG_IFACE_DEFAULT,
  CANDELARIA_ROUTER_NAME,
  MAGSAY_ROUTER_NAME,
} from "../lib/magsay-clone-pppoe.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DB = process.env.BILLING_DB || "";
const DRY = process.argv.includes("--dry-run");

const POOL_NAMES = new Set(POOL_NAME_LIST);
const PROFILE_NAMES = new Set(PROFILE_NAME_LIST);
const MAG_PPPOE_IFACE = process.env.MAG_PPPOE_IFACE || MAG_IFACE_DEFAULT;

let RouterOSAPI;

async function loadApi() {
  if (RouterOSAPI) return RouterOSAPI;
  ({ RouterOSAPI } = await import("../lib/routeros-api.js"));
  return RouterOSAPI;
}

function rowFromDb(db, name) {
  return (
    db.prepare("SELECT * FROM routers WHERE name=? AND enabled=1 ORDER BY id LIMIT 1").get(name) ||
    db.prepare("SELECT * FROM routers WHERE name LIKE ? ORDER BY id LIMIT 1").get(`%${name}%`)
  );
}

async function connFromEnvOrDb(kind) {
  const API = await loadApi();
  if (DB) {
    const db = new DatabaseSync(DB);
    const name = kind === "cande" ? CANDELARIA_ROUTER_NAME : MAGSAY_ROUTER_NAME;
    const row = rowFromDb(db, name);
    if (!row) throw new Error(`Router ${name} not found in ${DB}`);
    return new API({
      host: String(row.host).split(":")[0],
      user: row.username,
      password: row.password,
      port: Number(row.port) || 8728,
      ssl: !!row.ssl,
      timeout: 30000,
    });
  }
  const prefix = kind === "cande" ? "CANDE" : "MAG";
  const host = process.env[`${prefix}_HOST`];
  const user = process.env[`${prefix}_USER`];
  const pass = process.env[`${prefix}_PASS`];
  const port = Number(process.env[`${prefix}_PORT`] || 8728);
  if (!host || !user || !pass) {
    throw new Error(`Set BILLING_DB or ${prefix}_HOST/${prefix}_USER/${prefix}_PASS`);
  }
  return new API({ host, user, password: pass, port, timeout: 30000 });
}

function pick(obj, keys) {
  const o = {};
  for (const k of keys) if (obj[k] != null && obj[k] !== "") o[k] = obj[k];
  return o;
}

async function ensurePool(conn, name, ranges, comment) {
  const id = await conn.findId("/ip/pool", "name", name);
  if (id) {
    const row = (await conn.print("/ip/pool")).find((p) => p.name === name);
    const used = Number(row?.used || 0);
    if (used > 0) return { name, action: "keep-live-ranges", ranges: row.ranges, used };
    if (DRY) return { name, action: "would-update-ranges", ranges };
    await conn.setById("/ip/pool", id, { ranges, ...(comment ? { comment } : {}) });
    return { name, action: "updated-ranges", ranges };
  }
  if (DRY) return { name, action: "would-create", ranges };
  await conn.add("/ip/pool", { name, ranges, ...(comment ? { comment } : {}) });
  return { name, action: "created", ranges };
}

async function ensureProfile(conn, src, existing) {
  const attrs = {
    "rate-limit": src["rate-limit"] || "",
    "dns-server": src["dns-server"] || "",
    "address-list": src["address-list"] || "",
    "change-tcp-mss": src["change-tcp-mss"] || "default",
    "only-one": src["only-one"] || "default",
  };
  if (src.comment) attrs.comment = src.comment;
  if (!existing) {
    if (src["local-address"]) attrs["local-address"] = src["local-address"];
    if (src["remote-address"]) attrs["remote-address"] = src["remote-address"];
  }
  const id = await conn.findId("/ppp/profile", "name", src.name);
  if (id) {
    if (DRY) return { name: src.name, action: "would-update", keepLocalRemote: !!existing };
    await conn.setById("/ppp/profile", id, attrs);
    return { name: src.name, action: "updated", keepLocalRemote: !!existing };
  }
  if (DRY) return { name: src.name, action: "would-create" };
  await conn.add("/ppp/profile", {
    name: src.name,
    ...attrs,
    "local-address": src["local-address"] || "",
    "remote-address": src["remote-address"] || "",
  });
  return { name: src.name, action: "created" };
}

async function ensureMangleSpeedtest(conn, srcRules) {
  const existing = await conn.print("/ip/firewall/mangle");
  const out = [];
  for (const rule of srcRules) {
    const match = existing.find(
      (e) =>
        e.action === rule.action &&
        e.chain === rule.chain &&
        String(e["new-connection-mark"] || "") === String(rule["new-connection-mark"] || "") &&
        String(e["new-packet-mark"] || "") === String(rule["new-packet-mark"] || "") &&
        String(e.protocol || "") === String(rule.protocol || "") &&
        String(e["dst-port"] || "") === String(rule["dst-port"] || "") &&
        String(e["src-port"] || "") === String(rule["src-port"] || "") &&
        String(e["dst-address-list"] || "") === String(rule["dst-address-list"] || "") &&
        String(e["connection-mark"] || "") === String(rule["connection-mark"] || ""),
    );
    if (match) {
      out.push({ action: "exists", comment: rule.comment || rule.action });
      continue;
    }
    const add = pick(rule, [
      "chain",
      "action",
      "new-connection-mark",
      "new-packet-mark",
      "protocol",
      "dst-port",
      "src-port",
      "dst-address-list",
      "connection-mark",
      "passthrough",
      "comment",
    ]);
    if (DRY) {
      out.push({ action: "would-create", comment: rule.comment || rule.action });
      continue;
    }
    await conn.add("/ip/firewall/mangle", add);
    out.push({ action: "created", comment: rule.comment || rule.action });
  }
  return out;
}

async function syncPppoeServerSettings(conn, candeServers, magIface) {
  const src = candeServers.find((s) => String(s.disabled) !== "true") || candeServers[0];
  const rows = await conn.print("/interface/pppoe-server/server");
  const magSrv = rows.find((r) => r.interface === magIface) || rows[0];
  const attrs = {
    authentication: src.authentication,
    "one-session-per-host": src["one-session-per-host"],
    "keepalive-timeout": src["keepalive-timeout"] || "10",
    "default-profile": src["default-profile"] || "default",
    disabled: "false",
  };
  if (!magSrv) {
    if (DRY) return { action: "would-create", interface: magIface };
    await conn.add("/interface/pppoe-server/server", {
      interface: magIface,
      "service-name": "ppoe",
      ...attrs,
    });
    return { action: "created", interface: magIface };
  }
  if (DRY) return { action: "would-update-settings", interface: magSrv.interface, service: magSrv["service-name"] };
  await conn.setById("/interface/pppoe-server/server", magSrv[".id"], attrs);
  return { action: "updated-settings", interface: magSrv.interface, service: magSrv["service-name"] };
}

async function main() {
  const cande = connFromEnvOrDb("cande");
  const mag = connFromEnvOrDb("mag");
  const cId = await cande.identity();
  const mId = await mag.identity();
  console.log("Source:", cId.name || cId);
  console.log("Target:", mId.name || mId, DRY ? "(dry-run)" : "");

  const candePools = await cande.print("/ip/pool");
  const candeProfiles = await cande.print("/ppp/profile");
  const candeMangle = await cande.print("/ip/firewall/mangle");
  const candePppoe = await cande.print("/interface/pppoe-server/server");
  const magProfiles = await mag.print("/ppp/profile");

  const report = { pools: [], profiles: [], mangle: [], pppoeServer: null, secretsSkipped: true, dry: DRY };

  for (const p of candePools) {
    if (!POOL_NAMES.has(p.name)) continue;
    report.pools.push(await ensurePool(mag, p.name, p.ranges, p.comment || ""));
  }
  for (const p of candeProfiles) {
    if (!PROFILE_NAMES.has(p.name)) continue;
    const existing = magProfiles.find((x) => x.name === p.name);
    report.profiles.push(await ensureProfile(mag, p, existing));
  }
  report.mangle = await ensureMangleSpeedtest(mag, candeMangle);
  report.pppoeServer = await syncPppoeServerSettings(mag, candePppoe, MAG_PPPOE_IFACE);

  const secrets = await mag.print("/ppp/secret");
  report.secretsUntouched = secrets.length;

  console.log(JSON.stringify(report, null, 2));
  try {
    cande.close?.();
    mag.close?.();
  } catch {}
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  main().catch((e) => {
    console.error(e.message || e);
    process.exit(1);
  });
}

export { POOL_NAMES, PROFILE_NAMES, MAG_PPPOE_IFACE, CANDELARIA_ROUTER_NAME, MAGSAY_ROUTER_NAME };
