/**
 * PANISIJAN (router 51) — full GCash app fix on hotspot without WiFi login.
 * 1) Walled garden hosts + IPs
 * 2) hs-unauth firewall: allow DNS + HTTPS (GCash uses dynamic CDN IPs)
 * 3) jm-gcash address-list + accept rules
 *
 * Usage on VPS:
 *   cd /opt/jm-billing && node deploy/fix-panisijan-gcash-app.mjs
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROUTER = process.env.ROUTER_NAME || "PANISIJAN";

function run(script, args = []) {
  console.log("\n>>> node deploy/" + script, ...args, "\n");
  const r = spawnSync("node", [path.join(ROOT, "deploy", script), ...args], {
    cwd: ROOT,
    stdio: "inherit",
    env: process.env,
  });
  if (r.status !== 0) process.exit(r.status || 1);
}

run("apply-panisijan-gcash-walled-garden.mjs");
run("fix-gcash-app-hotspot.mjs", [ROUTER]);
run("fix-panisijan-captive-portal.mjs");

console.log("\n=== PANISIJAN GCash fix complete ===");
console.log("Test: connect WiFi (no login) → open GCash app → should load.");
