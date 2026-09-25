/**
 * Restore Candelaria-kitifi (router 34) free WiFi globals changed by PANISIJAN setup.
 * Does not touch router 51 / PANISIJAN-specific settings.
 *
 * Usage: cd /opt/jm-billing && node deploy/restore-candelaria-free-wifi.mjs
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const DB = process.env.BILLING_DB || path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "billing.db");
const CANDELARIA_ROUTER_ID = 34;

const db = new DatabaseSync(DB);
const upsert = db.prepare("INSERT INTO settings (k,v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v");

upsert.run("kitifi_free_router_id", String(CANDELARIA_ROUTER_ID));

console.log("Restored Candelaria free WiFi defaults:");
console.log("  kitifi_free_router_id=" + CANDELARIA_ROUTER_ID);
console.log("PANISIJAN settings (kitifi_free_*_51, kitifi_free_mikrotik_routers) unchanged.");
