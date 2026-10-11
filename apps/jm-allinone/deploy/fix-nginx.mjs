// Upload nginx config and reload. VPS_PASS required.
import fs from "node:fs";
import path from "node:path";
import { Client } from "ssh2";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PASS = process.env.VPS_PASS || "";
const HOST = process.env.VPS_HOST || "187.77.145.131";
const conf = fs.readFileSync(path.join(__dirname, "nginx-jm-billing.conf"), "utf8");
const b64 = Buffer.from(conf).toString("base64");

function exec(conn, cmd) {
  return new Promise((resolve, reject) => {
    conn.exec(cmd, (err, stream) => {
      if (err) return reject(err);
      stream.on("data", (d) => process.stdout.write(d));
      stream.stderr.on("data", (d) => process.stderr.write(d));
      stream.on("close", (code) => (code ? reject(new Error("exit " + code)) : resolve()));
    });
  });
}

const conn = new Client();
conn.on("ready", async () => {
  try {
    await exec(conn, `echo ${b64} | base64 -d > /etc/nginx/sites-available/jm-billing`);
    await exec(conn, "ln -sf /etc/nginx/sites-available/jm-billing /etc/nginx/sites-enabled/jm-billing");
    await exec(conn, "rm -f /etc/nginx/sites-enabled/jmwifi.pro /etc/nginx/sites-enabled/default");
    await exec(conn, "nginx -t && systemctl reload nginx");
    await exec(conn, "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1/account");
    console.log("\nnginx OK");
    conn.end();
  } catch (e) {
    console.error(e.message);
    conn.end();
    process.exit(1);
  }
}).connect({ host: HOST, port: 22, username: "root", password: PASS, readyTimeout: 30000 });
