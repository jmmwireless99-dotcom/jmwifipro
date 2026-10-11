// Run remote commands on VPS via SSH. Usage: VPS_PASS=... node deploy/vps-exec.mjs "cmd1" "cmd2"
import { Client } from "ssh2";

const HOST = process.env.VPS_HOST || "187.77.145.131";
const USER = process.env.VPS_USER || "root";
const PASS = process.env.VPS_PASS || "";
const cmds = process.argv.slice(2);
if (!PASS || !cmds.length) {
  console.error("Usage: VPS_PASS=... node deploy/vps-exec.mjs \"command\"");
  process.exit(1);
}

function exec(conn, cmd) {
  return new Promise((resolve, reject) => {
    conn.exec(cmd, (err, stream) => {
      if (err) return reject(err);
      let out = "", errOut = "";
      stream.on("data", (d) => { out += d; process.stdout.write(d); });
      stream.stderr.on("data", (d) => { errOut += d; process.stderr.write(d); });
      stream.on("close", (code) => resolve({ code, out, errOut }));
    });
  });
}

const conn = new Client();
conn.on("ready", async () => {
  try {
    for (const cmd of cmds) {
      console.log(`\n$ ${cmd}\n`);
      const r = await exec(conn, cmd);
      if (r.code !== 0) process.exitCode = r.code;
    }
    conn.end();
  } catch (e) {
    console.error(e.message);
    conn.end();
    process.exit(1);
  }
}).on("error", (e) => { console.error(e.message); process.exit(1); })
  .connect({ host: HOST, port: 22, username: USER, password: PASS, readyTimeout: 30000 });
