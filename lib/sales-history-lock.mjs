/**
 * Sales month lock rule:
 * A sales month stays editable/deletable during that month and the next month only.
 *
 * Examples (today = 2026-10-02):
 *   2026-09 (September) → editable (grace month = October)
 *   2026-08 (August)    → locked (grace ended Sep 30; locked Oct 1)
 *
 * When today becomes 2026-11-01, September locks too.
 */

/** Parse YYYY-MM → { y, m } (m = 1-12) or null */
export function parseYearMonth(ym) {
  const s = String(ym || "").trim();
  const m = s.match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  if (!y || mo < 1 || mo > 12) return null;
  return { y, m: mo };
}

/** Add n months to YYYY-MM */
export function addMonths(ym, n) {
  const p = parseYearMonth(ym);
  if (!p) return null;
  const idx = p.y * 12 + (p.m - 1) + Number(n || 0);
  const y = Math.floor(idx / 12);
  const m = (idx % 12) + 1;
  return `${y}-${String(m).padStart(2, "0")}`;
}

export function monthNow(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Editable during sale month and the following month.
 * Locked starting the 1st day of (saleMonth + 2 months).
 */
export function isSalesMonthEditable(saleMonth, now = new Date()) {
  const sale = parseYearMonth(saleMonth);
  const cur = parseYearMonth(monthNow(now));
  if (!sale || !cur) return false;
  const saleIdx = sale.y * 12 + (sale.m - 1);
  const curIdx = cur.y * 12 + (cur.m - 1);
  // allowed: cur in [sale, sale+1]
  return curIdx >= saleIdx && curIdx <= saleIdx + 1;
}

export function salesMonthLockReason(saleMonth, now = new Date()) {
  if (isSalesMonthEditable(saleMonth, now)) return "";
  const sale = parseYearMonth(saleMonth);
  if (!sale) return "Invalid sales month.";
  const lockFrom = addMonths(saleMonth, 2);
  return `Locked — ${saleMonth} sales can only be edited/deleted until end of ${addMonths(saleMonth, 1)}. Locked since ${lockFrom}-01.`;
}
