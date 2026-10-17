import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { parseMbps, circuitRates } from "../lib/speeds.js";
import { parseMikrotikActive, parseSessions } from "../lib/sessions.js";
import { buildLibreQos } from "../lib/build.js";
import { loadBilling } from "../lib/load-billing.js";
import { makeBillingDb, sampleBilling } from "./support/billing-fixture.js";
import { SHAPED_HEADERS } from "../lib/csv.js";

test("plan strings become megabits", () => {
  assert.equal(parseMbps("100-Mbps"), 100);
  assert.equal(parseMbps("70Mbps"), 70);
  assert.equal(parseMbps("10M"), 10);
  assert.equal(parseMbps("512k"), 0.512);
  assert.equal(parseMbps("1G"), 1000);
  assert.equal(parseMbps("20"), 20);
  assert.equal(parseMbps(""), null);
  const rates = circuitRates("100-Mbps", "100-Mbps", { headroom: 1.15, minMbps: 1, fallbackMbps: 10 });
  assert.equal(rates.downloadMax, 115);
  assert.equal(rates.downloadMin, 1);
});

test("RouterOS active print and JSON sessions parse", () => {
  const terse = `0 R name="ana@jm" service=pppoe address=100.64.0.10 uptime=1h\n1 name=ben@jm address=100.64.0.11/32`;
  assert.deepEqual(parseMikrotikActive(terse), [
    { username: "ana@jm", ipv4: "100.64.0.10" },
    { username: "ben@jm", ipv4: "100.64.0.11" },
  ]);
  assert.equal(parseSessions({ "Ana@JM": "10.1.1.2" })[0].username, "Ana@JM");
});

test("billing rows become a LibreQoS 2.2 tree and shaped-device file", () => {
  const file = makeBillingDb(sampleBilling);
  const built = buildLibreQos(loadBilling(file), {
    settings: { upstreamDownloadMbps: 100, upstreamUploadMbps: 80, siteDownloadMbps: 1000, apDownloadMbps: 5000, headroom: 1.15, minMbps: 1 },
    sessions: parseMikrotikActive(`name="ana@jm" address=100.64.8.10`),
  });
  fs.rmSync(file);
  assert.deepEqual(built.errors, []);
  assert.equal(built.summary.shaped, 2);
  assert.equal(built.summary.waitingForIp, 1);
  assert.equal(built.summary.skippedSuspended, 1);
  assert.equal(built.network.Candelaria.downloadBandwidthMbps, 100);
  assert.equal(built.network.Candelaria.uploadBandwidthMbps, 80);
  const malubi = built.network["Candelaria router-6"];
  assert.equal(malubi.type, "site");
  assert.equal(malubi.children["EPON PON2"].type, "site");
  assert.equal(malubi.children["EPON PON2"].children["MAL.NAP06"].type, "ap");
  assert.equal(malubi.children["EPON PON2"].children["MAL.NAP06"].downloadBandwidthMbps, 100);
  assert.equal(malubi.children["EPON PON2"].children["MAL.NAP06"].latitude, 13.93);

  const ana = built.rows.find((row) => row["Circuit ID"] === "jm-10");
  assert.equal(ana["Parent Node"], "MAL.NAP06");
  assert.equal(ana["Parent Node ID"], "jm:nap:19");
  assert.equal(ana["Anchor Node ID"], "jm:nap:19");
  assert.equal(ana.IPv4, "100.64.8.10");
  assert.equal(ana.MAC, "ana@jm");
  assert.equal(ana["Download Max Mbps"], "115");
  assert.equal(ana["Download Min Mbps"], "1");

  const ben = built.rows.find((row) => row["Circuit ID"] === "jm-11");
  assert.equal(ben["Circuit Name"], "Plan 2 Site");
  assert.equal(ben.MAC, "20:ab:48:1f:42:84");
  assert.equal(ben.IPv4, "172.9.9.219");
  assert.equal(ben["Parent Node"], "Candelaria");
  assert.equal(built.pending[0].circuitId, "jm-13");
  assert.equal(built.pending[0].parent, "Unassigned");
  assert.ok(built.network.Unassigned);

  const header = built.csv.split("\n")[0];
  assert.equal(header, SHAPED_HEADERS.join(","));
  assert.equal(built.csv.includes("#"), false);
});
