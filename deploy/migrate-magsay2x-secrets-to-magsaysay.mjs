/**
 * Move all PPPoE secrets from MAGSAY2X-CORE → MAGSAYSAY-PPPOE.
 * Keeps L2TP/SSTP VPN secrets on MAGSAY2X-CORE.
 * Disables MAGSAY2X PPPoE server so only MAGSAYSAY answers clients.
 * Retargets billing customers router_id 53/54 → 55.
 *
 * Usage on VPS:
 *   BILLING_DB=/opt/jm-billing/billing.db node deploy/migrate-magsay2x-secrets-to-magsaysay.mjs
 *   BILLING_DB=/opt/jm-billing/billing.db node deploy/migrate-magsay2x-secrets-to-magsaysay.mjs --dry-run
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { MAGSAY_ROUTER_NAME } from "../lib/magsay-clone-pppoe.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DB = process.env.BILLING_DB || path.join(ROOT, "billing.db");
const DRY = process.argv.includes("--dry-run");
const CORE_NAME = "MAGSAY2X-CORE";
const MAG_NAME = MAGSAY_ROUTER_NAME;
const MAG_PPPOE_IFACE = process.env.MAG_PPPOE_IFACE || "sfp-sfpplus1";

async function loadApi() {
  const { RouterOSAPI } = await import("../lib/routeros-api.js");
  return RouterOSAPI;
}

function rowFromDb(db, name) {
  return (
    db.prepare("SELECT * FROM routers WHERE name=? AND enabled=1 ORDER BY id LIMIT 1").get(name) ||
    db.prepare("SELECT * FROM routers WHERE name LIKE ? ORDER BY id LIMIT 1").get(`%${name}%`)
  );
}

async function connFor(name) {
  const API = await loadApi();
  const db = new DatabaseSync(DB);
  const row = rowFromDb(db, name);
  if (!row) throw new Error(`Router ${name} not found in ${DB}`);
  return {
    db,
    row,
    api: new API({
      host: String(row.host).split(":")[0],
      user: row.username,
      password: row.password,
      port: Number(row.port) || 8728,
      ssl: !!row.ssl,
      timeout: 120000,
    }),
  };
}

function isPppoeSecret(s) {
  const svc = String(s.service || "any").toLowerCase();
  return svc === "pppoe" || svc === "any" || svc === "";
}

function isVpnSecret(s) {
  const svc = String(s.service || "").toLowerCase();
  return ["l2tp", "sstp", "ovpn", "pptp"].includes(svc);
}

async function ensureSecret(api, src) {
  const existing = await api.findId("/ppp/secret", "name", src.name);
  const attrs = {
    name: src.name,
    password: src.password || "",
    profile: src.profile || "default",
    service: src.service || "pppoe",
    disabled: src.disabled === "true" ? "true" : "false",
  };
  if (src["caller-id"]) attrs["caller-id"] = src["caller-id"];
  if (src.comment) attrs.comment = src.comment;
  if (DRY) return existing ? "would-update" : "would-create";
  if (existing) {
    await api.setById("/ppp/secret", existing, attrs);
    return "updated";
  }
  await api.add("/ppp/secret", attrs);
  return "created";
}

async function main() {
  const core = await connFor(CORE_NAME);
  const mag = await connFor(MAG_NAME);
  const db = new DatabaseSync(DB);
  const report = {
    dry: DRY,
    created: [],
    updated: [],
    removed: [],
    disconnected: [],
    keptVpn: [],
    errors: [],
    billingMoved: 0,
  };

  console.log("Source:", (await core.api.identity()).name);
  console.log("Target:", (await mag.api.identity()).name, DRY ? "(dry-run)" : "");

  const secrets = await core.api.print("/ppp/secret");
  const pppoe = secrets.filter(isPppoeSecret);
  const vpn = secrets.filter(isVpnSecret);
  report.keptVpn = vpn.map((s) => `${s.name}:${s.service}`);

  // Ensure Magasay PPPoE server on customer fabric interface
  const magPppoe = await mag.api.print("/interface/pppoe-server/server");
  const magSrv = magPppoe.find((s) => s.interface === MAG_PPPOE_IFACE) || magPppoe[0];
  if (!magSrv) {
    if (!DRY) {
      await mag.api.add("/interface/pppoe-server/server", {
        interface: MAG_PPPOE_IFACE,
        "service-name": "PPPOE1",
        authentication: "pap,chap,mschap1,mschap2",
        "one-session-per-host": "true",
        "keepalive-timeout": "10",
        "default-profile": "default",
        disabled: "false",
      });
    }
    report.pppoeServer = "created";
  } else if (!DRY) {
    await mag.api.setById("/interface/pppoe-server/server", magSrv[".id"], {
      interface: MAG_PPPOE_IFACE,
      disabled: "false",
      authentication: "pap,chap,mschap1,mschap2",
      "one-session-per-host": "true",
      "keepalive-timeout": "10",
    });
    report.pppoeServer = "ensured";
  }

  for (const s of pppoe) {
    try {
      if (!s.password) {
        report.errors.push({ name: s.name, error: "empty-password" });
        continue;
      }
      const action = await ensureSecret(mag.api, s);
      if (String(action).includes("create")) report.created.push(s.name);
      else report.updated.push(s.name);
    } catch (e) {
      report.errors.push({ name: s.name, error: String(e.message || e) });
    }
  }

  for (const srv of await core.api.print("/interface/pppoe-server/server")) {
    if (String(srv.disabled) === "true") continue;
    if (!DRY) await core.api.setById("/interface/pppoe-server/server", srv[".id"], { disabled: "true" });
    report.corePppoeDisable = srv.interface;
  }

  const actives = (await core.api.print("/ppp/active")).filter((a) =>
    /pppoe/i.test(String(a.service || "pppoe")),
  );
  for (const a of actives) {
    try {
      if (!DRY) await core.api.removeById("/ppp/active", a[".id"]);
      report.disconnected.push(a.name);
    } catch (e) {
      report.errors.push({ name: a.name, error: "disconnect:" + (e.message || e) });
    }
  }

  for (const s of pppoe) {
    try {
      const id = await core.api.findId("/ppp/secret", "name", s.name);
      if (!id) continue;
      if (!DRY) await core.api.removeById("/ppp/secret", id);
      report.removed.push(s.name);
    } catch (e) {
      report.errors.push({ name: s.name, error: "remove:" + (e.message || e) });
    }
  }

  if (!DRY) {
    report.billingMoved = db.prepare("UPDATE customers SET router_id=? WHERE router_id=?").run(mag.row.id, core.row.id).changes;
    const disabled = db.prepare("SELECT id FROM routers WHERE name LIKE ? AND enabled=0").get("%MAGSAY2X%");
    if (disabled) {
      report.billingMoved54 = db.prepare("UPDATE customers SET router_id=? WHERE router_id=?").run(mag.row.id, disabled.id).changes;
    }
  }

  report.verify = {
    magSecrets: (await mag.api.print("/ppp/secret")).length,
    corePppoeLeft: (await core.api.print("/ppp/secret")).filter(isPppoeSecret).length,
    coreVpnLeft: (await core.api.print("/ppp/secret")).filter(isVpnSecret).length,
    magActive: (await mag.api.print("/ppp/active")).filter((a) => /pppoe/i.test(String(a.service || "pppoe"))).length,
    coreActivePppoe: (await core.api.print("/ppp/active")).filter((a) =>
      /pppoe/i.test(String(a.service || "pppoe")),
    ).length,
    billingOnMag: db.prepare("SELECT COUNT(*) n FROM customers WHERE router_id=?").get(mag.row.id).n,
  };

  console.log(JSON.stringify(report, null, 2));
  try {
    core.api.close?.();
    mag.api.close?.();
  } catch {}
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  main().catch((e) => {
    console.error(e.message || e);
    process.exit(1);
  });
}

export { isPppoeSecret, isVpnSecret, MAG_PPPOE_IFACE, CORE_NAME, MAG_NAME };
