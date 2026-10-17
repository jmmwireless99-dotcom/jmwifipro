import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadBilling } from "../lib/load-billing.js";
import { buildLibreQos } from "../lib/build.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const dbPath = path.join(root, "backup/20260703T234918Z/databases/jm-billing-billing.db");

test("JM billing snapshot exports a valid LibreQoS 2.2 plan", { skip: !fs.existsSync(dbPath) }, () => {
  const built = buildLibreQos(loadBilling(dbPath));
  assert.deepEqual(built.errors, []);
  assert.ok(built.summary.customers >= 290);
  assert.ok(built.summary.routers >= 2);
  assert.equal(built.summary.shaped, 0);
  assert.ok(built.summary.waitingForIp > 200);
  assert.ok(built.summary.skippedSuspended >= 30);
  assert.equal(built.summary.mappedCircuits, built.summary.shaped);
  assert.ok(built.summary.mappedCircuits <= 1000);
  for (const row of built.rows) {
    assert.equal(built.csv.includes(row["Circuit ID"]), true);
    assert.ok(Number(row["Download Max Mbps"]) >= Number(row["Download Min Mbps"]));
  }
});
