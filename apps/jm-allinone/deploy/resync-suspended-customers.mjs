/**
 * Re-apply suspended-pool profile on router for customers marked suspended in billing.
 * Usage: node deploy/resync-suspended-customers.mjs [username]
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Customers, Routers, Settings } from "../lib/db.js";
import { RouterOSAPI } from "../lib/routeros-api.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
process.chdir(path.resolve(__dirname, ".."));

const ONLY = process.argv[2] || "";
const SUSP = Settings.get("suspended_profile", "suspended-pool") || "suspended-pool";

function connFor(r) {
  return new RouterOSAPI({
    host: (r.host || "").split(":")[0],
    user: r.username,
    password: r.password,
    port: Number(r.port) || (r.ssl ? 8729 : 8728),
    ssl: !!r.ssl,
    timeout: 15000,
  });
}

async function routerProfile(conn, username) {
  const rows = await conn.print("/ppp/secret", { "?name": username });
  return String(rows?.[0]?.profile || "");
}

async function main() {
  let list = Customers.list().filter((c) => c.status === "suspended" && String(c.username || "").trim());
  if (ONLY) list = list.filter((c) => c.username === ONLY || String(c.id) === ONLY);
  if (!list.length) {
    console.log("No suspended customers to sync.");
    return;
  }
  console.log("Suspended profile:", SUSP, "| customers:", list.length);

  for (const c of list) {
    const r = (c.router_id && Routers.get(c.router_id)) || Routers.getDefault();
    if (!r) {
      console.log("SKIP", c.username, "— no router");
      continue;
    }
    const conn = connFor(r);
    const cur = await routerProfile(conn, c.username);
    if (cur.toLowerCase() === SUSP.toLowerCase()) {
      console.log("OK", c.username, "already on", cur);
      continue;
    }
    await conn.updatePppoe(c.username, { profile: SUSP });
    try {
      await conn.disconnectPppoe(c.username);
    } catch {}
    const after = await routerProfile(conn, c.username);
    console.log("FIXED", c.username, cur || "(empty)", "→", after, "on", r.name);
  }
}

main().catch((e) => {
  console.error("FAILED:", e.message || e);
  process.exit(1);
});
