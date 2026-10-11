#!/usr/bin/env node
// Upload add-domain-jmestre.sh + nginx conf and run them on the JM VPS.
// Prerequisites:
//   1) Hostinger DNS: A @ and www for jmestre.tech → 187.77.145.131
//   2) VPS_PASS set
//
// Usage: VPS_PASS=... node deploy/deploy-jmestre-domain.mjs
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
  console.error("VPS_PASS not set. Also point jmestre.tech A/@ and www to", HOST);
  console.error("  VPS_PASS=... node deploy/deploy-jmestre-domain.mjs");
  process.exit(1);
}

const FILES = [
  "deploy/add-domain-jmestre.sh",
  "deploy/nginx-jm-billing.conf",
];

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
      const ws = sftp.createWriteStream(remote, { mode: 0o755 });
      ws.on("close", resolve);
      ws.on("error", reject);
      rs.on("error", reject);
      rs.pipe(ws);
    } catch (e) {
      reject(e);
    }
  });
}

function exec(conn, cmd) {
  return new Promise((resolve, reject) => {
    conn.exec(cmd, (err, stream) => {
      if (err) return reject(err);
      let errOut = "";
      stream.on("data", (d) => process.stdout.write(d));
      stream.stderr.on("data", (d) => {
        errOut += d;
        process.stderr.write(d);
      });
      stream.on("close", (code) => (code === 0 ? resolve() : reject(new Error(errOut || `exit ${code}`))));
    });
  });
}

const conn = new Client();
conn
  .on("ready", () => {
    conn.sftp(async (err, sftp) => {
      if (err) {
        conn.end();
        console.error(err.message);
        process.exit(1);
      }
      try {
        console.log(`Uploading domain setup to ${USER}@${HOST}:${REMOTE}\n`);
        for (const rel of FILES) {
          const local = path.join(ROOT, rel);
          if (!fs.existsSync(local)) throw new Error("missing " + rel);
          console.log("  " + rel);
          await uploadFile(sftp, local, `${REMOTE}/${rel}`);
        }
        console.log("\nRunning add-domain-jmestre.sh on VPS...\n");
        await exec(conn, `bash ${REMOTE}/deploy/add-domain-jmestre.sh`);
        console.log("\nDone.");
        conn.end();
      } catch (e) {
        console.error("\nFailed:", e.message);
        conn.end();
        process.exit(1);
      }
    });
  })
  .on("error", (e) => {
    console.error(e.message);
    process.exit(1);
  })
  .connect({ host: HOST, port: 22, username: USER, password: PASS, readyTimeout: 30000 });
