#!/usr/bin/env node
// Safe deploy: Kitifi auto-pause (cloud voucher RADIUS + remaining API). Does NOT touch billing.db data rows or .env secrets.
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
const STAMP = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15);

const FILES = [
  "lib/voucher-sales.js",
  "lib/radius-server.js",
  "lib/hotspot-central.js",
  "server.js",
  "public/hotspot/jmwifi-roam.js",
  "public/hotspot/login.html",
  "deploy/enable-cloud-hotspot-radius.mjs",
];

if (!PASS) {
  console.error("VPS_PASS not set.");
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

function mkdirp(sftp, remoteDir) {
  return new Promise((resolve, reject) => {
    sftp.mkdir(remoteDir, { mode: 0o755 }, (err) => {
      if (!err || err.code === 4) return resolve();
      reject(err);
    });
  });
}

function uploadFile(sftp, local, remote) {
  return new Promise(async (resolve, reject) => {
    try {
      await mkdirp(sftp, path.posix.dirname(remote));
      const rs = fs.createReadStream(local);
      const ws = sftp.createWriteStream(remote, { mode: 0o644 });
      ws.on("close", resolve);
      ws.on("error", reject);
      rs.on("error", reject);
      rs.pipe(ws);
    } catch (e) { reject(e); }
  });
}

const conn = new Client();
conn.on("ready", () => {
  conn.sftp(async (err, sftp) => {
    if (err) { console.error(err); conn.end(); process.exit(1); }
    try {
      console.log("Backing up on VPS...");
      await exec(conn, `mkdir -p ${REMOTE}/.backup/${STAMP} && for f in ${FILES.join(" ")}; do if [ -f ${REMOTE}/$f ]; then cp -a ${REMOTE}/$f ${REMOTE}/.backup/${STAMP}/$f; fi; done`);
      for (const rel of FILES) {
        const local = path.join(ROOT, rel);
        if (!fs.existsSync(local)) throw new Error("Missing: " + rel);
        process.stdout.write("  " + rel + "\n");
        await uploadFile(sftp, local, `${REMOTE}/${rel}`);
      }
      console.log("\nEnabling cloud_hotspot_enabled...");
      await exec(conn, `cd ${REMOTE} && node deploy/enable-cloud-hotspot-radius.mjs`);
      console.log("\nRestarting jm-billing...");
      await exec(conn, "systemctl restart jm-billing && sleep 2 && systemctl is-active jm-billing");
      console.log("\nDeploy OK. Kitifi servers should send RADIUS accounting to UDP 1813.");
      conn.end();
    } catch (e) {
      console.error("\nDeploy failed:", e.message);
      conn.end();
      process.exit(1);
    }
  });
}).on("error", (e) => {
  console.error(e.message);
  process.exit(1);
}).connect({ host: HOST, port: 22, username: USER, password: PASS, readyTimeout: 30000 });
