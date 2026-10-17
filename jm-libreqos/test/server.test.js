import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { makeBillingDb, sampleBilling } from "./support/billing-fixture.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function listen(server) {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
}

test("bridge UI API applies a PPPoE session and pushes LibreQoS 2.2", async () => {
  const dbFile = makeBillingDb(sampleBilling);
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "jm-lqos-data-"));
  const seen = [];
  const shaper = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      seen.push(req.url);
      res.writeHead(200);
      res.end("ok");
    });
  });
  const shaperPort = await listen(shaper);
  const child = spawn(process.execPath, ["server.js"], {
    cwd: root,
    env: {
      ...process.env,
      BILLING_DB: dbFile,
      DATA_DIR: dataDir,
      HOST: "127.0.0.1",
      PORT: "0",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  const bridgePort = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(log || "bridge did not start")), 5000);
    child.stdout.on("data", (chunk) => {
      log += chunk;
      const match = log.match(/http:\/\/127\.0\.0\.1:(\d+)/);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
    child.stderr.on("data", (chunk) => { log += chunk; });
    child.on("exit", (code) => reject(new Error(`bridge exited ${code}: ${log}`)));
  });
  const base = `http://127.0.0.1:${bridgePort}`;
  try {
    const before = await (await fetch(`${base}/api/preview`)).json();
    assert.equal(before.summary.shaped, 1);
    assert.equal(before.rows[0].circuitId, "jm-11");
    assert.equal(before.summary.waitingForIp, 2);

    const applied = await (await fetch(`${base}/api/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: '0 R name="ana@jm" service=pppoe address=100.64.8.10' }),
    })).json();
    assert.equal(applied.count, 1);
    const after = await (await fetch(`${base}/api/preview`)).json();
    assert.equal(after.summary.shaped, 2);
    assert.equal(after.rows.find((row) => row.circuitId === "jm-10").ipv4, "100.64.8.10");
    assert.equal(after.rows.find((row) => row.circuitId === "jm-10").parent, "MAL.NAP06");

    const page = await (await fetch(base)).text();
    assert.match(page, /JM <span>LibreQoS<\/span> 2\.2/);

    await fetch(`${base}/api/settings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ apiBase: `http://127.0.0.1:${shaperPort}`, apiKey: "lqos_api_demo", reloadAfterPush: true }),
    });
    const pushed = await (await fetch(`${base}/api/push`, { method: "POST" })).json();
    assert.equal(pushed.ok, true);
    assert.deepEqual(seen, ["/health", "/network_json/update", "/shaped_devices/update", "/reload_libreqos"]);
  } finally {
    child.kill("SIGTERM");
    shaper.close();
  }
});
