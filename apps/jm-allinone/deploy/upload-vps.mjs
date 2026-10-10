// One-time VPS upload via SFTP (uses ssh2). Run: node deploy/upload-vps.mjs
// Credentials passed via env: VPS_HOST, VPS_USER, VPS_PASS
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Client } from "ssh2";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const HOST = process.env.VPS_HOST || "187.77.145.131";
const USER = process.env.VPS_USER || "root";
const PASS = process.env.VPS_PASS || "";
const REMOTE = process.env.VPS_REMOTE || "/opt/jm-billing";

const SKIP = new Set(["node_modules", ".git", "tools"]);
const SKIP_EXT = [".bat"];

function walk(dir, base = dir) {
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const rel = path.relative(base, full).replace(/\\/g, "/");
    if (SKIP.has(name)) continue;
    const st = fs.statSync(full);
    if (st.isDirectory()) out.push(...walk(full, base));
    else if (!SKIP_EXT.some((e) => name.endsWith(e))) out.push(rel);
  }
  return out;
}

function mkdirp(sftp, remoteDir) {
  return new Promise((resolve, reject) => {
    sftp.mkdir(remoteDir, { mode: 0o755 }, (err) => {
      if (!err || err.code === 4) return resolve(); // exists
      reject(err);
    });
  });
}

async function uploadFile(sftp, local, remote) {
  await mkdirp(sftp, path.posix.dirname(remote));
  return new Promise((resolve, reject) => {
    const rs = fs.createReadStream(local);
    const ws = sftp.createWriteStream(remote, { mode: 0o644 });
    ws.on("close", resolve);
    ws.on("error", reject);
    rs.on("error", reject);
    rs.pipe(ws);
  });
}

function exec(conn, cmd) {
  return new Promise((resolve, reject) => {
    conn.exec(cmd, (err, stream) => {
      if (err) return reject(err);
      let out = "", errOut = "";
      stream.on("data", (d) => { out += d; process.stdout.write(d); });
      stream.stderr.on("data", (d) => { errOut += d; process.stderr.write(d); });
      stream.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error(errOut || `exit ${code}`))));
    });
  });
}

if (!PASS) {
  console.error("Set VPS_PASS environment variable");
  process.exit(1);
}

const dbPath = path.join(ROOT, "billing.db");
if (fs.existsSync(dbPath)) {
  try {
    const db = new DatabaseSync(dbPath);
    db.exec("PRAGMA wal_checkpoint(FULL)");
    console.log("Database checkpointed for upload.");
  } catch (e) {
    console.warn("DB checkpoint skipped:", e.message);
  }
}

const files = walk(ROOT);
console.log(`Uploading ${files.length} files to ${USER}@${HOST}:${REMOTE}`);

const conn = new Client();
conn.on("ready", () => {
  conn.sftp(async (err, sftp) => {
    if (err) { console.error(err); conn.end(); process.exit(1); }
    try {
      await exec(conn, `mkdir -p ${REMOTE}`);
      for (const rel of files) {
        const local = path.join(ROOT, rel);
        const remote = `${REMOTE}/${rel}`;
        process.stdout.write(`  ${rel}\n`);
        await uploadFile(sftp, local, remote);
      }
      console.log("\nRunning setup on VPS...");
      await exec(conn, `chmod +x ${REMOTE}/deploy/hostinger-vps-setup.sh && bash ${REMOTE}/deploy/hostinger-vps-setup.sh`);
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
