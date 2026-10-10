// Upload specific files to VPS and restart jm-billing.
// Usage: VPS_PASS=... node deploy/push-files.mjs lib/db.js server.js public/index.html
import fs from "node:fs";
import path from "node:path";
import { Client } from "ssh2";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const HOST = process.env.VPS_HOST || "187.77.145.131";
const USER = process.env.VPS_USER || "root";
const PASS = process.env.VPS_PASS || "";
const REMOTE = process.env.VPS_REMOTE || "/opt/jm-billing";
const files = process.argv.slice(2).map((f) => f.replace(/\\/g, "/"));

if (!PASS || !files.length) {
  console.error("Usage: VPS_PASS=... node deploy/push-files.mjs <file>...");
  process.exit(1);
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
conn.on("ready", () => {
  conn.sftp(async (err, sftp) => {
    if (err) {
      console.error(err);
      conn.end();
      process.exit(1);
    }
    try {
      for (const rel of files) {
        const local = path.join(ROOT, rel);
        if (!fs.existsSync(local)) throw new Error("Missing: " + rel);
        const remote = `${REMOTE}/${rel}`;
        console.log("  " + rel);
        await uploadFile(sftp, local, remote);
      }
      console.log("\nRestarting jm-billing...");
      await exec(conn, "systemctl restart jm-billing && sleep 2 && systemctl is-active jm-billing");
      console.log("\nDone.");
      conn.end();
    } catch (e) {
      console.error("\nFailed:", e.message);
      conn.end();
      process.exit(1);
    }
  });
}).on("error", (e) => {
  console.error(e.message);
  process.exit(1);
}).connect({ host: HOST, port: 22, username: USER, password: PASS, readyTimeout: 30000 });
