import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  APPLY_COVERAGE,
  APPLY_MUNICIPALITIES,
  APPLY_NOT_AVAILABLE,
  APPLY_NOT_FOUND,
  barangaysFor,
  formatApplyAddress,
  resolveApplyCoverage,
} from "../lib/apply-coverage.mjs";
import { patchServerJs } from "../deploy/apply-address-dropdowns.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("coverage lists the seven municipalities and expected barangay counts", () => {
  assert.deepEqual(APPLY_MUNICIPALITIES, [
    "PALANAS", "CATAINGAN", "CAWAYAN", "USON", "MILAGROS", "AROROY", "PLACER",
  ]);
  assert.equal(APPLY_COVERAGE.PALANAS.length, 18);
  assert.equal(APPLY_COVERAGE.CATAINGAN.length, 8);
  assert.equal(APPLY_COVERAGE.CAWAYAN.length, 27);
  assert.equal(APPLY_COVERAGE.USON.length, 20);
  assert.equal(APPLY_COVERAGE.MILAGROS.length, 8);
  assert.equal(APPLY_COVERAGE.AROROY.length, 15);
  assert.equal(APPLY_COVERAGE.PLACER.length, 4);
  assert.ok(APPLY_COVERAGE.PALANAS.includes("PIÑA"));
  assert.ok(APPLY_COVERAGE.CAWAYAN.includes("PEÑA ISLAND"));
  assert.ok(APPLY_COVERAGE.CATAINGAN.includes("CAGBATANG"));
  assert.ok(!APPLY_COVERAGE.USON.includes("MISSING"));
});

test("resolve allows listed Palanas / Cataingan addresses and blocks unknown areas", () => {
  const ok = resolveApplyCoverage("palanas", "pina");
  assert.equal(ok.ok, true);
  assert.equal(ok.municipality, "PALANAS");
  assert.equal(ok.barangay, "PIÑA");
  assert.equal(resolveApplyCoverage("CATAINGAN", "CADULAWAN").ok, true);
  assert.equal(resolveApplyCoverage("PLACER", "PURO").ok, true);
  const miss = resolveApplyCoverage("PALANAS", "UNKNOWN");
  assert.equal(miss.ok, false);
  assert.equal(miss.error, APPLY_NOT_AVAILABLE);
  assert.equal(resolveApplyCoverage("SORSOGON", "POBLACION").ok, false);
  assert.equal(resolveApplyCoverage("PALANAS", APPLY_NOT_FOUND).ok, false);
  assert.equal(barangaysFor("cawayan").length, 27);
  assert.equal(
    formatApplyAddress("PALANAS", "POBLACION", "Purok 1"),
    "Purok 1, POBLACION, PALANAS, Masbate"
  );
});

test("apply page uses municipality then barangay dropdowns and blocks missing areas", () => {
  const html = fs.readFileSync(path.join(ROOT, "public/portal/apply.html"), "utf8");
  assert.match(html, /id="muni"/);
  assert.match(html, /id="brgy"/);
  assert.match(html, /Hindi ko makita ang barangay ko/);
  assert.match(html, /Not available pa/);
  assert.match(html, /hindi kayo maka-proceed/i);
  assert.doesNotMatch(html, /id="address"/);
  assert.doesNotMatch(html, /id="area"/);
  const blob = html.match(/const APPLY_COVERAGE=(\{.*?\});/s);
  assert.ok(blob, "embedded coverage object");
  const embedded = JSON.parse(blob[1]);
  assert.deepEqual(Object.keys(embedded), APPLY_MUNICIPALITIES);
  for (const m of APPLY_MUNICIPALITIES) {
    assert.deepEqual(embedded[m], APPLY_COVERAGE[m]);
  }
});

test("server.js patcher validates coverage on POST /api/apply", () => {
  const fake = [
    'import { JobOrders } from "./lib/db.js";',
    '    if (pathname === "/api/apply" && req.method === "POST") {',
    "      const parsed = parseApplyBody(b);",
    "      if (parsed.error) return send(res, 400, { ok: false, error: parsed.error });",
    '      if (!b.contact || !String(b.contact).trim()) return send(res, 400, { ok: false, error: "Please enter a contact number." });',
    '      if (!b.agreed) return send(res, 400, { ok: false, error: "Please read and tick the agreement to continue." });',
    "      const s = Settings.all();",
    "}",
  ].join("\n");
  const { src, changed, missing } = patchServerJs(fake);
  assert.deepEqual(missing, []);
  assert.equal(changed, true);
  assert.match(src, /resolveApplyCoverage/);
  assert.match(src, /formatApplyAddress/);
  assert.match(src, /lib\/apply-coverage\.mjs/);
});
