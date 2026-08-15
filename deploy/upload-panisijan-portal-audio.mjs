#!/usr/bin/env node
/**
 * Upload PANISIJAN portal background music to jmwifi.pro VPS.
 * Usage:
 *   node deploy/upload-panisijan-portal-audio.mjs "/path/to/Free WiFi Panisihan.mp3"
 */
import fs from "node:fs";
import path from "node:path";
import { Client } from "ssh2";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const src = process.argv[2];
const HOST = process.env.VPS_HOST || "187.77.145.131";
const USER = process.env.VPS_USER || "root";
const PASS = process.env.VPS_PASS || "Father@services1985";
const REMOTE_DIR = "/opt/jm-billing/public/hotspot/audio";
const REMOTE_NAME = "free-wifi-panisijan.mp3";

if (!src || !fs.existsSync(src)) {
  console.error("Usage: node deploy/upload-panisijan-portal-audio.mjs <local-mp3-path>");
  console.error('Example: node deploy/upload-panisijan-portal-audio.mjs "Free WiFi Panisihan.mp3"');
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

function upload(sftp, local, remote) {
  return new Promise((resolve, reject) => {
    const rs = fs.createReadStream(local);
    const ws = sftp.createWriteStream(remote, { mode: 0o644 });
    ws.on("close", resolve);
    ws.on("error", reject);
    rs.on("error", reject);
    rs.pipe(ws);
  });
}

const conn = new Client();
conn.on("ready", () => {
  conn.sftp(async (err, sftp) => {
    if (err) {
      console.error(err);
      conn.end();
      process.exit(1);
    }
    try {
      await exec(conn, `mkdir -p ${REMOTE_DIR}`);
      const remote = `${REMOTE_DIR}/${REMOTE_NAME}`;
      console.log("Uploading", src, "->", remote);
      await upload(sftp, path.resolve(src), remote);
      const stat = fs.statSync(path.resolve(src));
      console.log("Done.", Math.round(stat.size / 1024), "KB");
      console.log("URL: https://jmwifi.pro/hotspot/audio/free-wifi-panisijan.mp3");
      conn.end();
    } catch (e) {
      console.error("Failed:", e.message);
      conn.end();
      process.exit(1);
    }
  });
}).on("error", (e) => {
  console.error(e.message);
  process.exit(1);
}).connect({ host: HOST, port: 22, username: USER, password: PASS, readyTimeout: 30000 });
