/**
 * Restore IPOE-CABDELARIA site in billing DB, test API, apply IPoE firewall.
 * Usage: BILLING_DB=billing.db node deploy/restore-ipoe-candelaria.mjs
 */
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { RouterOSAPI } from "../lib/routeros-api.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DB = process.env.BILLING_DB || path.join(ROOT, "billing.db");
const ROUTER = {
  name: "IPOE-CABDELARIA",
  host: "lazy3.kurifotremoteall.org",
  port: 20524,
  username: "IPOE1",
  area: "CANDELARIA",
  enabled: 1,
  is_default: 0,
  ssl: 0,
};

function getSetting(db, k) {
  return db.prepare("SELECT v FROM settings WHERE k=?").get(k)?.v || "";
}

async function testConn(row) {
  const conn = new RouterOSAPI({
    host: String(row.host).split(":")[0],
    user: row.username,
    password: row.password,
    port: Number(row.port) || 8728,
    ssl: !!row.ssl,
    timeout: 20000,
  });
  const ident = await conn.identity();
  const wanRoutes = await conn.print("/ip/route");
  const def = wanRoutes.find((r) => String(r.dst || r["dst-address"] || "").startsWith("0.0.0.0"));
  let wan = "";
  if (def) {
    const gw = String(def["immediate-gw"] || def.gateway || "");
    const m = gw.match(/%([^,\s]+)/);
    wan = m ? m[1] : (def.interface || "");
  }
  const dhcp = await conn.print("/ip/dhcp-server");
  try { conn.close?.(); } catch {}
  return { identity: ident.name || ident, wan, dhcp: dhcp.map((d) => d.name) };
}

async function main() {
  const db = new DatabaseSync(DB);
  const pass = getSetting(db, "mikrotik_password");
  if (!pass) {
    console.error("No mikrotik_password in settings — set it in billing Settings first.");
    process.exit(1);
  }

  let row = db.prepare("SELECT * FROM routers WHERE name=?").get(ROUTER.name);
  if (!row) {
    const res = db.prepare(
      "INSERT INTO routers (name,host,port,username,password,ssl,area,vpn_notes,enabled,is_default) VALUES (?,?,?,?,?,?,?,?,?,?)"
    ).run(ROUTER.name, ROUTER.host, ROUTER.port, ROUTER.username, pass, 0, ROUTER.area, "JMPRO-IPOE prepaid site", 1, 0);
    row = db.prepare("SELECT * FROM routers WHERE id=?").get(res.lastInsertRowid);
    console.log("Created router:", row.name, "id", row.id);
  } else {
    db.prepare("UPDATE routers SET host=?, port=?, username=?, password=?, area=?, enabled=1 WHERE id=?")
      .run(ROUTER.host, ROUTER.port, ROUTER.username, pass, ROUTER.area, row.id);
    row = db.prepare("SELECT * FROM routers WHERE id=?").get(row.id);
    console.log("Updated router:", row.name, "id", row.id);
  }

  console.log("Testing API…");
  const t = await testConn(row);
  console.log("Identity:", t.identity);
  console.log("WAN:", t.wan || "(unknown — pass as 2nd arg to apply-suspend-firewall)");
  console.log("DHCP servers:", t.dhcp.join(", ") || "(none)");

  db.prepare("UPDATE routers SET last_status=?, last_seen=datetime('now','localtime') WHERE id=?")
    .run("ok", row.id);

  console.log("\nNext: run IPoE firewall apply:");
  console.log(`  BILLING_DB=${DB} node deploy/apply-suspend-firewall.mjs --ipoe ${ROUTER.name}${t.wan ? " " + t.wan : ""}`);
}

main().catch((e) => {
  console.error("FAILED:", e.message || e);
  process.exit(1);
});
