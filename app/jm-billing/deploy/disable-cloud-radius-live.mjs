#!/usr/bin/env node
/** Disable cloud RADIUS on live VPS — settings only, then restart jm-billing. */
import fs from "node:fs";
import path from "node:path";
import { Client } from "ssh2";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function loadEnv() {
  const envPath = path.join(ROOT, ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([^#=]+)=(.*)$/);
    if (!m) continue;
    const k = m[1].trim();
    if (!process.env[k]) process.env[k] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}
loadEnv();

const HOST = process.env.VPS_HOST || "187.77.145.131";
const USER = process.env.VPS_USER || "root";
const PASS = process.env.VPS_PASS || "";
const REMOTE = process.env.VPS_REMOTE || "/opt/jm-billing";

if (!PASS) {
  console.error("VPS_PASS not set. Run:");
  console.error("  VPS_PASS='your-root-password' node deploy/disable-cloud-radius-live.mjs");
  process.exit(1);
}

function exec(conn, cmd) {
  return new Promise((resolve, reject) => {
    conn.exec(cmd, (err, stream) => {
      if (err) return reject(err);
      let errOut = "";
      stream.on("data", (d) => process.stdout.write(d));
      stream.stderr.on("data", (d) => { errOut += d; process.stderr.write(d); });
      stream.on("close", (code) => (code === 0 ? resolve() : reject(new Error(errOut || `exit ${code}`))));
    });
  });
}

const conn = new Client();
conn.on("ready", async () => {
  try {
    console.log("Before:");
    await exec(conn, `sqlite3 ${REMOTE}/billing.db "SELECT k,v FROM settings WHERE k IN ('cloud_hotspot_enabled','hotspot_central','radius_host');"`);
    console.log("\nDisabling cloud RADIUS...");
    await exec(conn, `cd ${REMOTE} && node deploy/disable-cloud-hotspot-radius.mjs 2>/dev/null || sqlite3 billing.db "UPDATE settings SET v='0' WHERE k IN ('cloud_hotspot_enabled','hotspot_central'); INSERT OR IGNORE INTO settings(k,v) VALUES('cloud_hotspot_enabled','0'),('hotspot_central','0');"`);
    console.log("\nRestarting jm-billing...");
    await exec(conn, "systemctl restart jm-billing && sleep 2 && systemctl is-active jm-billing");
    console.log("\nAfter:");
    await exec(conn, `sqlite3 ${REMOTE}/billing.db "SELECT k,v FROM settings WHERE k IN ('cloud_hotspot_enabled','hotspot_central','radius_host');"`);
    console.log("\nDone — cloud RADIUS hotspot is OFF.");
    conn.end();
  } catch (e) {
    console.error("\nFailed:", e.message);
    conn.end();
    process.exit(1);
  }
}).on("error", (e) => {
  console.error(e.message);
  process.exit(1);
}).connect({ host: HOST, port: 22, username: USER, password: PASS, readyTimeout: 30000 });
