/**
 * Per-router free WiFi on/off (does not change other sites).
 *
 * Usage:
 *   node deploy/set-per-router-free-wifi-enabled.mjs 34=0 51=1
 *   ROUTER_ID=51 ENABLED=1 node deploy/set-per-router-free-wifi-enabled.mjs
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const DB = process.env.BILLING_DB || path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "billing.db");
const db = new DatabaseSync(DB);
const upsert = db.prepare("INSERT INTO settings (k,v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v");

const pairs = process.argv.slice(2).filter((a) => a.includes("="));
if (!pairs.length && process.env.ROUTER_ID) {
  pairs.push(String(process.env.ROUTER_ID) + "=" + (process.env.ENABLED ?? "1"));
}
if (!pairs.length) {
  console.error("Usage: node deploy/set-per-router-free-wifi-enabled.mjs 34=0 51=1");
  process.exit(1);
}

for (const pair of pairs) {
  const [ridRaw, onRaw] = pair.split("=");
  const rid = Number(ridRaw);
  if (!rid) {
    console.error("Invalid router id:", ridRaw);
    process.exit(1);
  }
  const on = String(onRaw).trim() === "1" || String(onRaw).trim().toLowerCase() === "on" ? "1" : "0";
  const key = "kitifi_free_enabled_" + rid;
  upsert.run(key, on);
  console.log(key + "=" + on + " (" + (on === "1" ? "ON" : "OFF") + ")");
}
