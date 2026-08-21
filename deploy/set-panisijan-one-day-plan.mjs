/**
 * PANISIJAN (router 51) — ₱20 One Day Internet GCash QR plan.
 *
 * Usage: cd /opt/jm-billing && node deploy/set-panisijan-one-day-plan.mjs
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const DB = process.env.BILLING_DB || path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "billing.db");
const ROUTER_ID = 51;

const PLAN = {
  id: "r1day",
  name: "One Day Internet",
  price: 20,
  uptime: "1 Day",
  time: "1 Day",
  expiry: "1 Day",
  pause_limit: "0",
  label: "₱ 20 | 1 Day | Expires in 1 Day | 0",
  amount_display: "₱ 20",
  profile: "default",
  kitifi_rate_id: "1day",
  r_id: "1day",
  speed: "4Mbps",
};

const db = new DatabaseSync(DB);
const upsert = db.prepare("INSERT INTO settings (k,v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v");
upsert.run("kitifi_plans_" + ROUTER_ID, JSON.stringify([PLAN]));
upsert.run("kitifi_gen_profile_" + ROUTER_ID, "default");

console.log("PANISIJAN router", ROUTER_ID, "GCash plan:");
console.log(" ", PLAN.label);
console.log("Setting: kitifi_plans_" + ROUTER_ID);
