import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  FREE_INSTALL_COVERAGE,
  FREE_INSTALL_MUNICIPALITIES,
  FREE_INSTALL_NOT_AVAILABLE,
  barangaysForFreeInstall,
  resolveFreeInstallationCoverage,
} from "../lib/free-installation-coverage.mjs";
import {
  APPLY_ARGS_OLD,
  APPLY_SQL_OLD,
  GET_OLD,
  IMPORT_OLD,
  POST_OLD,
  patchDbJs,
  patchIndexHtml,
  patchServerJs,
} from "../lib/free-installation-page.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("free install lists all municipalities but only Aroroy/Manamoc is open", () => {
  assert.deepEqual(FREE_INSTALL_MUNICIPALITIES, [
    "PALANAS", "CATAINGAN", "CAWAYAN", "USON", "MILAGROS", "AROROY", "PLACER",
  ]);
  assert.deepEqual(FREE_INSTALL_COVERAGE.AROROY, ["MANAMOC"]);
  assert.deepEqual(FREE_INSTALL_COVERAGE.PALANAS, []);
  assert.deepEqual(FREE_INSTALL_COVERAGE.USON, []);
  assert.deepEqual(barangaysForFreeInstall("aroroy"), ["MANAMOC"]);
  assert.deepEqual(barangaysForFreeInstall("PALANAS"), []);
});

test("only Aroroy Manamoc can proceed; other addresses are blocked", () => {
  const ok = resolveFreeInstallationCoverage("aroroy", "manamoc");
  assert.equal(ok.ok, true);
  assert.equal(ok.municipality, "AROROY");
  assert.equal(ok.barangay, "MANAMOC");
  assert.equal(resolveFreeInstallationCoverage("AROROY", "MALUBI").ok, false);
  assert.equal(resolveFreeInstallationCoverage("PALANAS", "POBLACION").ok, false);
  assert.equal(resolveFreeInstallationCoverage("USON", "CANDELARIA").ok, false);
  const miss = resolveFreeInstallationCoverage("AROROY", "__none__");
  assert.equal(miss.ok, false);
  assert.equal(miss.error, FREE_INSTALL_NOT_AVAILABLE);
});

test("public page embeds empty barangay lists except Manamoc and posts to free API", () => {
  const html = fs.readFileSync(path.join(ROOT, "public/portal/free-installation.html"), "utf8");
  assert.match(html, /Free Installation/);
  assert.match(html, /\/api\/apply\/free-installation/);
  assert.match(html, /"AROROY":\["MANAMOC"\]/);
  assert.match(html, /"PALANAS":\[\]/);
  assert.match(html, /₱0/);
  assert.match(html, /Hindi maka-proceed/);
  assert.doesNotMatch(html, /"PALANAS":\["ANTIPOLO"/);
});

test("server and db patchers add /free/installation and FREE-INSTALL marking", () => {
  const srv = patchServerJs([IMPORT_OLD, GET_OLD, POST_OLD].join("\n"));
  assert.equal(srv.changed, true);
  assert.deepEqual(srv.missing, []);
  assert.match(srv.src, /resolveFreeInstallationCoverage/);
  assert.match(srv.src, /\/free\/installation/);
  assert.match(srv.src, /\/api\/apply\/free-installation/);
  assert.match(srv.src, /install_fee: 0/);
  assert.match(srv.src, /FREE-INSTALL/);
  const db = patchDbJs([APPLY_SQL_OLD, APPLY_ARGS_OLD].join("\n"));
  assert.equal(db.changed, true);
  assert.match(db.src, /marking_order/);
  const idx = patchIndexHtml('        <button class="refresh" onclick="loadFreeInstalls()">⟳ refresh</button>');
  assert.equal(idx.changed, true);
  assert.match(idx.src, /\/free\/installation/);
});
