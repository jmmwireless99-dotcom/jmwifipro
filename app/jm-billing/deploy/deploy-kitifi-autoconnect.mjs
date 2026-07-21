#!/usr/bin/env node
// Deploy KiTifi auto-connect pages only (safe — HTML/JS, no DB). Requires VPS_PASS.
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

const FILES = [
  "public/kitifi/index.html",
  "public/kitifi/generator-buy.html",
  "public/kitifi/payment-return.html",
  "public/kitifi/kitifi-connect.js",
  "public/hotspot/kitifi-autoconnect.js",
  "public/hotspot/kitifi-buy.html",
  "public/hotspot/jmwifi-roam.js",
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
      for (const rel of FILES) {
        const local = path.join(ROOT, rel);
        if (!fs.existsSync(local)) throw new Error("Missing: " + rel);
        process.stdout.write("  " + rel + "\n");
        await uploadFile(sftp, local, `${REMOTE}/${rel}`);
      }
      console.log("\nRestarting jm-billing...");
      await exec(conn, "systemctl restart jm-billing && sleep 2 && systemctl is-active jm-billing");
      console.log("\nDeploy OK — KiTifi GCash auto-connect active.");
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
