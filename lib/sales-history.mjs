/**
 * Sales history aggregations — weekly / monthly / yearly, by barangay & vendo.
 */

import { APPLY_COVERAGE, listAllBarangays } from "./apply-coverage.mjs";
import { SALES_ROWS } from "./sales-history-data.mjs";

/** Parse YYYY-MM-DD as local calendar date (no TZ shift). */
export function parseDate(iso) {
  const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

export function formatDate(d) {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${mo}-${day}`;
}

/** Monday-start ISO week key: YYYY-Www */
export function weekKey(d) {
  const date = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = (date.getDay() + 6) % 7; // Mon=0
  date.setDate(date.getDate() - day + 3); // Thu of that week
  const week1 = new Date(date.getFullYear(), 0, 4);
  const weekNo =
    1 +
    Math.round(
      ((date.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7
    );
  const y = date.getFullYear();
  return `${y}-W${String(weekNo).padStart(2, "0")}`;
}

export function monthKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function yearKey(d) {
  return String(d.getFullYear());
}

export function periodKey(d, range) {
  if (range === "weekly") return weekKey(d);
  if (range === "yearly") return yearKey(d);
  return monthKey(d);
}

export function filterRows(rows, { municipality, barangay, range, period, from, to } = {}) {
  return (rows || []).filter((r) => {
    if (municipality && String(r.municipality).toUpperCase() !== String(municipality).toUpperCase()) {
      return false;
    }
    if (barangay && String(r.barangay).toUpperCase() !== String(barangay).toUpperCase()) {
      return false;
    }
    const d = parseDate(r.date);
    if (!d) return false;
    if (range && period) {
      if (periodKey(d, range) !== period) return false;
    }
    if (from) {
      const f = parseDate(from);
      if (f && d < f) return false;
    }
    if (to) {
      const t = parseDate(to);
      if (t && d > t) return false;
    }
    return true;
  });
}

export function sumAmount(rows) {
  return (rows || []).reduce((n, r) => n + (Number(r.amount) || 0), 0);
}

/**
 * Overall totals for dashboard KPIs (optional barangay/muni filter).
 */
export function overallTotals(rows = SALES_ROWS, filters = {}, now = new Date()) {
  const filtered = filterRows(rows, filters);
  const thisWeek = weekKey(now);
  const thisMonth = monthKey(now);
  const thisYear = yearKey(now);
  const weekRows = filtered.filter((r) => {
    const d = parseDate(r.date);
    return d && weekKey(d) === thisWeek;
  });
  const monthRows = filtered.filter((r) => {
    const d = parseDate(r.date);
    return d && monthKey(d) === thisMonth;
  });
  const yearRows = filtered.filter((r) => {
    const d = parseDate(r.date);
    return d && yearKey(d) === thisYear;
  });
  return {
    weekly: sumAmount(weekRows),
    monthly: sumAmount(monthRows),
    yearly: sumAmount(yearRows),
    all: sumAmount(filtered),
    weekKey: thisWeek,
    monthKey: thisMonth,
    yearKey: thisYear,
  };
}

/**
 * Per-barangay rollup: vendo names + total sale.
 * Includes every APPLY_COVERAGE barangay (0 if no sales yet).
 */
export function barangaySummary(rows = SALES_ROWS, filters = {}, coverage = APPLY_COVERAGE) {
  const filtered = filterRows(rows, filters);
  const map = new Map();

  for (const { municipality, barangay } of listAllBarangays(coverage)) {
    if (filters.municipality && municipality !== String(filters.municipality).toUpperCase()) continue;
    if (filters.barangay && barangay !== String(filters.barangay).toUpperCase()) continue;
    const key = `${municipality}::${barangay}`;
    map.set(key, {
      municipality,
      barangay,
      vendos: [],
      vendoSet: new Set(),
      total: 0,
      rows: 0,
    });
  }

  for (const r of filtered) {
    const m = String(r.municipality || "").toUpperCase();
    const b = String(r.barangay || "").toUpperCase();
    const key = `${m}::${b}`;
    let entry = map.get(key);
    if (!entry) {
      entry = { municipality: m, barangay: b, vendos: [], vendoSet: new Set(), total: 0, rows: 0 };
      map.set(key, entry);
    }
    const vendo = String(r.vendo || "").trim() || "(unnamed)";
    entry.vendoSet.add(vendo);
    entry.total += Number(r.amount) || 0;
    entry.rows += 1;
  }

  const list = [...map.values()].map((e) => {
    const vendos = [...e.vendoSet].sort((a, b) => a.localeCompare(b));
    return {
      municipality: e.municipality,
      barangay: e.barangay,
      vendos,
      vendoCount: vendos.length,
      total: e.total,
      rows: e.rows,
    };
  });

  list.sort((a, b) => b.total - a.total || a.barangay.localeCompare(b.barangay));
  return list;
}

/** Per-vendo totals within filtered rows. */
export function vendoSummary(rows = SALES_ROWS, filters = {}) {
  const filtered = filterRows(rows, filters);
  const map = new Map();
  for (const r of filtered) {
    const m = String(r.municipality || "").toUpperCase();
    const b = String(r.barangay || "").toUpperCase();
    const v = String(r.vendo || "").trim() || "(unnamed)";
    const key = `${m}::${b}::${v}`;
    const cur = map.get(key) || { municipality: m, barangay: b, vendo: v, total: 0, rows: 0 };
    cur.total += Number(r.amount) || 0;
    cur.rows += 1;
    map.set(key, cur);
  }
  return [...map.values()].sort((a, b) => b.total - a.total || a.vendo.localeCompare(b.vendo));
}

/** Bucket totals for chart: weekly | monthly | yearly. */
export function periodSeries(rows = SALES_ROWS, range = "monthly", filters = {}) {
  const filtered = filterRows(rows, filters);
  const map = new Map();
  for (const r of filtered) {
    const d = parseDate(r.date);
    if (!d) continue;
    const key = periodKey(d, range);
    map.set(key, (map.get(key) || 0) + (Number(r.amount) || 0));
  }
  return [...map.entries()]
    .map(([period, total]) => ({ period, total }))
    .sort((a, b) => a.period.localeCompare(b.period));
}

export function peso(n) {
  return "₱" + Number(n || 0).toLocaleString("en-PH", { maximumFractionDigits: 0 });
}
