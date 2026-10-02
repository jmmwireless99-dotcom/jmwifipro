import assert from "node:assert/strict";
import { APPLY_COVERAGE, listAllBarangays } from "../lib/apply-coverage.mjs";
import { SALES_ROWS } from "../lib/sales-history-data.mjs";
import {
  overallTotals,
  barangaySummary,
  vendoSummary,
  periodSeries,
  filterRows,
  sumAmount,
  weekKey,
  monthKey,
  yearKey,
  parseDate,
} from "../lib/sales-history.mjs";
import { patchServerJs } from "../deploy/sales-history.mjs";

const LIVE_COVERAGE = {
  PALANAS: [
    "ANTIPOLO",
    "BANCO",
    "BIGA-A",
    "BONTOD",
    "BUENASUERTE",
    "INTUSAN",
    "MAANAHAO",
    "MABINI",
    "MALATAWAN",
    "MALIBAS",
    "NABANGIG",
    "PARINA",
    "PIÑA",
    "POBLACION",
    "SALVACION",
    "SAN ANTONIO",
    "SAN CARLOS",
    "SAN ISIDRO",
  ],
  CATAINGAN: [
    "CADULAWAN",
    "CAGBATANG",
    "ESTAMPAR",
    "LIONG",
    "MAANAHAO",
    "MATUBINAO",
    "OSMENIA",
    "SAN ISIDRO",
  ],
  CAWAYAN: [
    "CABAYUGAN",
    "CALAPAYAN",
    "CALUMPANG",
    "CHICO ISLAND",
    "DALIPE",
    "DIVISORIA",
    "IRAYA",
    "LAGUE-LAGUE",
    "LIBERTAD",
    "MACTAN",
    "MADBAD",
    "MAIHAO",
    "MALBUG",
    "PALOBANDERA",
    "PANAN-AWAN",
    "PEÑA ISLAND",
    "PIN-AS",
    "POBLACION",
    "PULOT",
    "SAN JOSE",
    "SAN VICENTE",
    "TABERNA",
    "TALISAY",
    "TUBOG",
    "TUBURAN",
    "VILLAHERMOSA",
    "VILLAGANAS VILLAGE",
  ],
  USON: [
    "ARADO",
    "AURORA",
    "BONIFACIO",
    "BUENASUERTE",
    "BUENAVISTA",
    "CAMPANA",
    "CANDELARIA",
    "DEL CARMEN",
    "DEL ROSARIO",
    "LIBERTAD",
    "MABINI",
    "NABUHAY",
    "MAGSAYSAY",
    "MONGAHAY",
    "PAGUIHAMAN",
    "SAN ISIDRO",
    "SAN JOSE",
    "SAN MATEO",
    "SAN RAMON",
    "SAN VICENTE",
  ],
  MILAGROS: ["BARA", "BURABOD", "BURUNGON", "MATAGBAC", "SAN CARLOS", "SAWMILL", "TESA", "CAMARIN"],
  AROROY: [
    "AMOTAG",
    "BAGAUMA",
    "BALETE",
    "CABAS-AN",
    "CONCEPTION",
    "BART-AG",
    "DAYHAGAN",
    "MACABUG",
    "MALUBI",
    "MANAMOC",
    "MARIPOSA",
    "MATUNGOG",
    "PANIQUE",
    "DON PABLO",
    "TINIGBAN",
  ],
  PLACER: ["CABANGCALAN", "MAHAYAHAY", "PURO", "TAN-AWAN"],
};

assert.deepEqual(APPLY_COVERAGE, LIVE_COVERAGE, "coverage must match jmwifi.pro/apply");
assert.equal(listAllBarangays().length, 100, "7 municipalities · 100 barangays");

assert.ok(SALES_ROWS.length > 0, "sample sales rows present");
for (const r of SALES_ROWS) {
  assert.ok(parseDate(r.date), "valid date " + r.date);
  assert.ok(APPLY_COVERAGE[r.municipality], "known muni " + r.municipality);
  assert.ok(
    APPLY_COVERAGE[r.municipality].includes(r.barangay),
    "known barangay " + r.barangay + " in " + r.municipality
  );
  assert.ok(String(r.vendo).trim(), "vendo name required");
  assert.ok(Number(r.amount) >= 0, "amount >= 0");
}

const candelaria = filterRows(SALES_ROWS, { municipality: "USON", barangay: "CANDELARIA" });
assert.ok(candelaria.length >= 2, "candelaria has rows");
assert.ok(sumAmount(candelaria) > 0);

const summary = barangaySummary(SALES_ROWS);
assert.equal(summary.length, 100, "summary covers every apply barangay");
const top = summary.find((s) => s.barangay === "CANDELARIA" && s.municipality === "USON");
assert.ok(top);
assert.ok(top.vendos.includes("Vendo Candelaria Plaza"));
assert.ok(top.total > 0);

const vendos = vendoSummary(SALES_ROWS, { barangay: "MALBUG" });
assert.ok(vendos.some((v) => v.vendo.includes("Malbug")));

const now = new Date(2026, 9, 2); // Oct 2, 2026
const totals = overallTotals(SALES_ROWS, {}, now);
assert.equal(totals.monthKey, "2026-10");
assert.equal(totals.yearKey, "2026");
assert.ok(totals.monthly > 0, "october sales");
assert.ok(totals.yearly > 0, "2026 sales");
assert.ok(totals.weekly >= 0);

const monthly = periodSeries(SALES_ROWS, "monthly");
assert.ok(monthly.some((p) => p.period === "2026-09"));
const weekly = periodSeries(SALES_ROWS, "weekly");
assert.ok(weekly.length > 0);
const yearly = periodSeries(SALES_ROWS, "yearly");
assert.deepEqual(
  yearly.map((y) => y.period),
  ["2026"]
);

assert.equal(weekKey(new Date(2026, 9, 2)).startsWith("2026-W"), true);
assert.equal(monthKey(new Date(2026, 8, 15)), "2026-09");
assert.equal(yearKey(new Date(2026, 0, 1)), "2026");

const fakeServer = `
    if (pathname === "/apply" && req.method === "GET") {
      return servePortalPage(res, "apply.html");
    }
`;
const patched = patchServerJs(fakeServer);
assert.equal(patched.changed, true);
assert.ok(patched.src.includes('pathname === "/sales-history"'));
assert.ok(patched.src.includes('pathname.startsWith("/lib/")'));

const again = patchServerJs(patched.src);
assert.equal(again.changed, false, "idempotent patch");

console.log("ok sales-history tests");
