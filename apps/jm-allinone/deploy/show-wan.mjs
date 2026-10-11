import { DatabaseSync } from "node:sqlite";
import { RouterOSAPI } from "../lib/routeros-api.js";

const db = new DatabaseSync("/opt/jm-billing/billing.db");
function get(k) {
  return db.prepare("SELECT v FROM settings WHERE k=?").get(k)?.v || "";
}
let pw = get("mikrotik_password");
if (pw === "***") pw = process.env.MIKROTIK_PASSWORD || "";

const conn = new RouterOSAPI({
  host: get("mikrotik_host").split(":")[0],
  user: get("mikrotik_user"),
  password: pw,
  port: Number(get("mikrotik_port")) || 8728,
  timeout: 15000,
});

const routes = await conn.print("/ip/route");
const ifs = await conn.interfaces();
console.log("default routes:", JSON.stringify(routes.filter((r) => String(r.dst || r["dst-address"] || "").startsWith("0.0.0.0")), null, 2));
console.log("interfaces:", JSON.stringify(ifs.map((i) => ({ name: i.name, type: i.type, running: i.running, disabled: i.disabled })), null, 2));
try { conn.close && conn.close(); } catch {}
