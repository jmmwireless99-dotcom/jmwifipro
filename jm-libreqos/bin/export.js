#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { loadBilling } from "../lib/load-billing.js";
import { buildLibreQos } from "../lib/build.js";
import { parseSessions } from "../lib/sessions.js";

function arg(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1] || fallback;
}

const dbPath = arg("--db", process.env.BILLING_DB || "");
const outDir = arg("--out", path.resolve("out"));
const sessionsFile = arg("--sessions", "");
if (!dbPath) {
  console.error("Usage: node bin/export.js --db billing.db --out out/ [--sessions sessions.json]");
  process.exit(1);
}

const sessions = sessionsFile ? parseSessions(fs.readFileSync(sessionsFile, "utf8")) : [];
const built = buildLibreQos(loadBilling(dbPath), { sessions });
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "network.json"), JSON.stringify(built.network, null, 2) + "\n");
fs.writeFileSync(path.join(outDir, "ShapedDevices.csv"), built.csv);
fs.writeFileSync(path.join(outDir, "report.json"), JSON.stringify({
  target: built.target,
  summary: built.summary,
  warnings: built.warnings,
  errors: built.errors,
  pending: built.pending,
}, null, 2) + "\n");

console.log(JSON.stringify(built.summary, null, 2));
if (built.warnings.length) console.log(`warnings: ${built.warnings.length}`);
if (built.errors.length) {
  console.error(built.errors.join("\n"));
  process.exit(1);
}
