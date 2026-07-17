// Shared VPS deploy helpers (loads .env from project root).
import fs from "node:fs";
import path from "node:path";
import { Client } from "ssh2";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, "..");

export function loadEnv() {
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

export const HOST = process.env.VPS_HOST || "187.77.145.131";
export const USER = process.env.VPS_USER || "root";
export const PASS = process.env.VPS_PASS || "";
export const REMOTE = process.env.VPS_REMOTE || "/opt/jm-billing";

const SKIP_DIRS = new Set(["node_modules", ".git", "tools", "data", "archives"]);
const SKIP_FILES = new Set(["billing.db", "billing.db-wal", "billing.db-shm", ".env"]);

/** Collect app files to sync (code only — never overwrites live VPS database). */
export function collectAppFiles() {
  const out = [];
  const addWalk = (dir, base) => {
    if (!fs.existsSync(dir)) return;
    for (const name of fs.readdirSync(dir)) {
      if (SKIP_DIRS.has(name)) continue;
      const full = path.join(dir, name);
      const rel = path.relative(base, full).replace(/\\/g, "/");
      const st = fs.statSync(full);
      if (st.isDirectory()) addWalk(full, base);
      else if (!SKIP_FILES.has(name) && !name.endsWith(".bat")) out.push(rel);
    }
  };
  if (fs.existsSync(path.join(ROOT, "server.js"))) out.push("server.js");
  addWalk(path.join(ROOT, "lib"), ROOT);
  addWalk(path.join(ROOT, "public"), ROOT);
  addWalk(path.join(ROOT, "deploy"), ROOT);
  return [...new Set(out)].sort();
}

export function relPath(abs) {
  return path.relative(ROOT, abs).replace(/\\/g, "/");
}

export function shouldSyncRel(rel) {
  rel = rel.replace(/\\/g, "/");
  if (!rel || SKIP_FILES.has(path.basename(rel))) return false;
  if (rel.endsWith(".bat")) return false;
  for (const part of rel.split("/")) if (SKIP_DIRS.has(part)) return false;
  if (rel === "server.js") return true;
  if (rel.startsWith("lib/") || rel.startsWith("public/") || rel.startsWith("deploy/")) return true;
  return false;
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

export function uploadToVps(files, { restart = true } = {}) {
  if (!PASS) throw new Error("VPS_PASS not set — add it to .env in the project folder.");
  const list = [...new Set(files.map((f) => f.replace(/\\/g, "/")))].filter(shouldSyncRel);
  if (!list.length) return Promise.resolve({ uploaded: 0 });

  return new Promise((resolve, reject) => {
    const conn = new Client();
    conn.on("ready", () => {
      conn.sftp(async (err, sftp) => {
        if (err) {
          conn.end();
          return reject(err);
        }
        try {
          for (const rel of list) {
            const local = path.join(ROOT, rel);
            if (!fs.existsSync(local)) continue;
            process.stdout.write("  " + rel + "\n");
            await uploadFile(sftp, local, `${REMOTE}/${rel}`);
          }
          if (restart) {
            console.log("\nRestarting jm-billing...");
            await exec(conn, "systemctl restart jm-billing && sleep 2 && systemctl is-active jm-billing");
          }
          console.log("\nDone.");
          conn.end();
          resolve({ uploaded: list.length });
        } catch (e) {
          conn.end();
          reject(e);
        }
      });
    }).on("error", reject).connect({ host: HOST, port: 22, username: USER, password: PASS, readyTimeout: 30000 });
  });
}
