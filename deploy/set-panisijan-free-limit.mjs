/**
 * PANISIJAN (router 51) — enforce 1 free internet claim per day.
 * Usage: cd /opt/jm-billing && node deploy/set-panisijan-free-limit.mjs
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const DB = process.env.BILLING_DB || path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "billing.db");
const ROUTER_ID = 51;
const LIMIT = String(process.env.FREE_LIMIT_PER_DAY || "1");

const db = new DatabaseSync(DB);
const upsert = db.prepare("INSERT INTO settings (k,v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v");

upsert.run("kitifi_free_limit_per_day_" + ROUTER_ID, LIMIT);
upsert.run("kitifi_free_enabled", "1");
console.log("PANISIJAN free internet: max", LIMIT, "claim(s) per day (router", ROUTER_ID + ")");
console.log("Setting: kitifi_free_limit_per_day_" + ROUTER_ID + "=" + LIMIT);
