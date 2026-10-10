#!/usr/bin/env node
// Surgical deploy: upload VPS CPU/RAM status files and patch live server.js in place.
// Never overwrites billing.db or .env. Does not replace the whole server.js with a branch copy.
// Usage: VPS_PASS=... node deploy/deploy-vps-status.mjs
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
  console.error("VPS_PASS not set. Add VPS_PASS=... to .env or run:");
  console.error("  VPS_PASS=... node deploy/deploy-vps-status.mjs");
  process.exit(1);
}

const IMPORT_LINE = 'import { vpsHostStatus } from "./lib/vps-host.js";';
const ROUTE_LINE = '  "/api/vps/status": () => vpsHostStatus(),';

function patchServerJs(src) {
  let out = src;
  if (!out.includes("vpsHostStatus") || !out.includes("./lib/vps-host.js")) {
    if (out.includes(IMPORT_LINE)) {
      // already imported
    } else if (/import \{ MikroTik \} from "\.\/lib\/mikrotik\.js";/.test(out)) {
      out = out.replace(
        /import \{ MikroTik \} from "\.\/lib\/mikrotik\.js";/,
        `import { MikroTik } from "./lib/mikrotik.js";\n${IMPORT_LINE}`
      );
    } else {
      throw new Error("Could not find MikroTik import anchor in remote server.js");
    }
  }
  if (!out.includes('"/api/vps/status"')) {
    if (/\"\/api\/status\":\s*async \(\) =>/.test(out)) {
      out = out.replace(
        /(\"\/api\/status\":\s*async \(\) =>[^\n]+),?/,
        `$1,\n${ROUTE_LINE}`
      );
    } else {
      throw new Error("Could not find /api/status route anchor in remote server.js");
    }
  }
  return out;
}

function exec(conn, cmd) {
  return new Promise((resolve, reject) => {
    conn.exec(cmd, (err, stream) => {
      if (err) return reject(err);
      let out = "", errOut = "";
      stream.on("data", (d) => {
        out += d;
        process.stdout.write(d);
      });
      stream.stderr.on("data", (d) => {
        errOut += d;
        process.stderr.write(d);
      });
      stream.on("close", (code) =>
        code === 0 ? resolve(out) : reject(new Error(errOut || out || `exit ${code}`))
      );
    });
  });
}

function uploadFile(sftp, local, remote) {
  return new Promise((resolve, reject) => {
    const rs = fs.createReadStream(local);
    const ws = sftp.createWriteStream(remote, { mode: 0o644 });
    ws.on("close", resolve);
    ws.on("error", reject);
    rs.on("error", reject);
    rs.pipe(ws);
  });
}

function readRemote(sftp, remote) {
  return new Promise((resolve, reject) => {
    let data = "";
    const rs = sftp.createReadStream(remote, { encoding: "utf8" });
    rs.on("data", (c) => (data += c));
    rs.on("end", () => resolve(data));
    rs.on("error", reject);
  });
}

function writeRemote(sftp, remote, content) {
  return new Promise((resolve, reject) => {
    const ws = sftp.createWriteStream(remote, { mode: 0o644 });
    ws.on("close", resolve);
    ws.on("error", reject);
    ws.end(content);
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
        const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15);
        console.log(`Patching ${USER}@${HOST}:${REMOTE}\n`);

        await exec(conn, `mkdir -p ${REMOTE}/lib ${REMOTE}/public ${REMOTE}/backups`);
        await exec(
          conn,
          `cp -a ${REMOTE}/server.js ${REMOTE}/backups/server.js.vps-status-${stamp} && cp -a ${REMOTE}/public/index.html ${REMOTE}/backups/index.html.vps-status-${stamp}`
        );

        console.log("  lib/vps-host.js");
        await uploadFile(sftp, path.join(ROOT, "lib/vps-host.js"), `${REMOTE}/lib/vps-host.js`);

        console.log("  public/index.html");
        await uploadFile(sftp, path.join(ROOT, "public/index.html"), `${REMOTE}/public/index.html`);

        console.log("  server.js (surgical patch)");
        const remoteServer = await readRemote(sftp, `${REMOTE}/server.js`);
        const patched = patchServerJs(remoteServer);
        if (patched === remoteServer) {
          console.log("  (server.js already had VPS status hooks)");
        } else {
          await writeRemote(sftp, `${REMOTE}/server.js`, patched);
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
  })
  .on("error", (e) => {
    console.error(e.message);
    process.exit(1);
  })
  .connect({ host: HOST, port: 22, username: USER, password: PASS, readyTimeout: 30000 });
