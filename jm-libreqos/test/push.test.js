import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { pushToLibreQos } from "../lib/push.js";

test("push sends LibreQoS 2.2 file updates with x-bearer", async () => {
  const seen = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      seen.push({ url: req.url, header: req.headers["x-bearer"], type: req.headers["content-type"], body: Buffer.concat(chunks).toString("utf8") });
      res.writeHead(req.url === "/health" ? 200 : 204);
      res.end(req.url === "/health" ? "ok" : "");
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    const result = await pushToLibreQos({
      apiBase: `http://127.0.0.1:${port}`,
      apiKey: "lqos_api_test",
      network: { Site: { downloadBandwidthMbps: 100, uploadBandwidthMbps: 100, type: "site", id: "jm:router:1" } },
      csv: "Circuit ID,Circuit Name\n",
      reload: true,
    });
    assert.equal(result.ok, true);
    assert.deepEqual(seen.map((step) => step.url), ["/health", "/network_json/update", "/shaped_devices/update", "/reload_libreqos"]);
    assert.equal(seen[1].header, "lqos_api_test");
    assert.equal(seen[1].type, "application/json");
    assert.match(seen[1].body, /"id":"jm:router:1"/);
    assert.equal(seen[2].type, "text/csv");
    assert.match(seen[2].body, /^Circuit ID/);
  } finally {
    server.close();
  }
});
